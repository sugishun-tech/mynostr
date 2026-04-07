const DEFAULT_CONFIG = {
  relays: [
    "wss://relay-jp.nostr.wirednet.jp/",
    "wss://yabu.me/",
    "wss://r.kojira.io/",
    "wss://nrelay-jp.c-stellar.net/",
  ],
  batchSize: 30,
  defaultIcon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23aab8c2' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E"
};

const app = {
  myPubkey: "",
  relays: [],
  eventStorage: new Map(),
  profiles: new Map(),
  nip05Status: new Map(),
  likedIds: new Set(),
  following: new Set(),
  subscriptions: new Map(),
  
  activeTab: 'public',
  previousTab: null,
  currentProfilePubkey: null,
  currentThreadId: null,
  
  state: {
    public:  { newest: 0, oldest: Math.floor(Date.now()/1000) },
    home:    { newest: 0, oldest: Math.floor(Date.now()/1000) },
    profile: { newest: 0, oldest: Math.floor(Date.now()/1000) },
    notifications: { newest: 0, oldest: Math.floor(Date.now()/1000) },
    thread:  { newest: 0, oldest: Math.floor(Date.now()/1000) }
  },

  async init() {
    this.loadSettings();
    this.connectRelays();
    this.updateBatchDisplay();
  },

  loadSettings() {
    const r = localStorage.getItem('nostr_relays');
    this.relayUrls = r ? r.split('\n').filter(url => url.trim()) : DEFAULT_CONFIG.relays;
    this.batchSize = parseInt(localStorage.getItem('nostr_batch_size')) || DEFAULT_CONFIG.batchSize;
    document.getElementById('relay-input').value = this.relayUrls.join('\n');
    document.getElementById('batch-input').value = this.batchSize;
  },

  updateBatchDisplay() {
    document.querySelectorAll('.batch-num').forEach(el => el.innerText = this.batchSize);
  },

  connectRelays() {
    this.relays.forEach(ws => ws.close());
    this.relays = [];
    this.relayUrls.forEach(url => {
      const ws = new WebSocket(url.trim());
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === "EVENT" && this.subscriptions.has(data[1])) {
            this.subscriptions.get(data[1])(data[2]);
          }
        } catch(e) {}
      };
      this.relays.push(ws);
    });
  },

  async login() {
    if (!window.nostr) return alert("NIP-07拡張機能（nos2x等）が見つかりません");
    try {
      this.myPubkey = await window.nostr.getPublicKey();
      document.getElementById('login-btn').classList.add('hidden');
      document.getElementById('profile-display').classList.remove('hidden');
      document.getElementById('post-avatar').classList.remove('hidden');
      
      this.fetchProfile(this.myPubkey, (p) => {
        document.getElementById('my-name').innerText = p.display_name || p.name || "User";
        const iconUrl = p.picture || DEFAULT_CONFIG.defaultIcon;
        document.getElementById('my-pic').src = iconUrl;
        document.getElementById('post-avatar').src = iconUrl;
      });
      
      this.query([{ kinds: [7], authors: [this.myPubkey] }], (ev) => {
        const eTag = ev.tags.find(t => t[0] === 'e');
        if (eTag) this.likedIds.add(eTag[1]);
      });

      this.query([{ kinds: [3], authors: [this.myPubkey], limit: 1 }], (ev) => {
        this.following = new Set(ev.tags.filter(t => t[0] === 'p').map(t => t[1]));
        if(this.activeTab === 'home') this.fetchFeed('older');
      });
    } catch (e) { console.error("Login failed:", e); }
  },

  async submitPost() {
    if (!this.myPubkey) return alert("ログインが必要です");
    const inputArea = document.getElementById('post-input');
    const content = inputArea.value.trim();
    if (!content) return;

    const event = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: content };
    try {
      const signedEvent = await window.nostr.signEvent(event);
      this.broadcast(signedEvent);
      inputArea.value = '';
      this.eventStorage.set(signedEvent.id, signedEvent);
      if (this.activeTab === 'home' || this.activeTab === 'public') {
        this.renderPost(signedEvent, true);
      }
    } catch (e) { alert("投稿に失敗しました"); }
  },

  async submitReply() {
    if (!this.myPubkey || !this.currentThreadId) return alert("エラー: 対象が存在しません");
    const inputArea = document.getElementById('reply-input');
    const content = inputArea.value.trim();
    if (!content) return;

    const parentEvent = this.eventStorage.get(this.currentThreadId);
    let tags = [["e", this.currentThreadId, "", "reply"]];
    if (parentEvent) {
      tags.push(["p", parentEvent.pubkey]);
      // 返信ツリーの参加者にも通知が行くようにpタグを追加
      parentEvent.tags.filter(t => t[0] === 'p').forEach(t => {
        if (t[1] !== this.myPubkey && !tags.some(ex => ex[0] === 'p' && ex[1] === t[1])) {
          tags.push(["p", t[1]]);
        }
      });
    }

    const event = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: tags, content: content };
    try {
      const signedEvent = await window.nostr.signEvent(event);
      this.broadcast(signedEvent);
      inputArea.value = '';
      this.eventStorage.set(signedEvent.id, signedEvent);
      
      // 送信完了後、スレッドを開き直して反映させる
      this.openThread(this.currentThreadId);
    } catch (e) { alert("返信に失敗しました"); }
  },

  broadcast(signedEvent) {
    this.relays.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["EVENT", signedEvent]));
    });
  },

  fetchFeed(direction) {
    const tab = this.activeTab;
    const state = this.state[tab];
    let filter = { kinds: [1] };

    if (tab === 'home') {
      if (!this.myPubkey) return alert("ログインが必要です");
      filter.authors = [this.myPubkey, ...Array.from(this.following)];
      if (filter.authors.length === 0) return;
    } else if (tab === 'profile') {
      if (!this.currentProfilePubkey) return;
      filter.authors = [this.currentProfilePubkey];
    } else if (tab === 'notifications') {
      if (!this.myPubkey) return alert("ログインが必要です");
      filter = { "#p": [this.myPubkey], kinds: [1, 7] };
    } else if (tab === 'thread') {
      filter = { "#e": [this.currentThreadId], kinds: [1] };
    }

    if (direction === 'latest') {
      filter.since = state.newest + 1;
      filter.until = Math.floor(Date.now() / 1000);
    } else if (direction === 'newer') {
      filter.since = state.newest + 1;
      filter.limit = this.batchSize;
    } else if (direction === 'older') {
      filter.until = state.oldest - 1;
      filter.limit = this.batchSize;
    }

    this.query([filter], (event) => {
      if (this.eventStorage.has(event.id) && direction !== 'latest' && direction !== 'newer') return; 
      this.eventStorage.set(event.id, event);
      
      state.newest = Math.max(state.newest, event.created_at);
      state.oldest = Math.min(state.oldest, event.created_at);

      if (tab === 'notifications') {
        this.renderNotification(event, direction !== 'older');
      } else {
        this.renderPost(event, direction !== 'older');
      }
    });
  },

  query(filters, onEvent) {
    const subId = "sub_" + Math.random().toString(36).substring(7);
    this.subscriptions.set(subId, onEvent);
    this.relays.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["REQ", subId, ...filters]));
    });
    setTimeout(() => {
      this.relays.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
      });
      this.subscriptions.delete(subId);
    }, 4000);
  },

  renderPost(ev, prepend, targetContainerId = null) {
    const containerId = targetContainerId || `timeline-${this.activeTab}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    if (ev.kind === 7 && containerId !== 'timeline-notifications') return;

    const profile = this.profiles.get(ev.pubkey) || {};
    const isLiked = this.likedIds.has(ev.id);
    const pubkeyHex = ev.pubkey.slice(0, 8) + '...';
    
    // NIP-24 拡張メタデータに対応した名前の処理
    let dName = profile.display_name || profile.name || "npub...";
    let sName = "@" + (profile.name || pubkeyHex);
    
    let badgeHtml = "";
    if (profile.nip05) {
      const status = this.nip05Status.get(profile.nip05);
      if (status === true) badgeHtml = `<span class="badge" title="Verified">✅</span>`;
      else if (status === false) badgeHtml = `<span class="badge" title="Invalid">⚠️</span>`;
      else this.verifyNip05(profile.nip05, ev.pubkey);
    }

    let replyContextHtml = "";
    const eTags = ev.tags.filter(t => t[0] === 'e');
    if (eTags.length > 0) {
      const replyTag = eTags.find(t => t[3] === 'reply') || eTags[eTags.length - 1];
      const replyId = replyTag[1];
      const parentEv = this.eventStorage.get(replyId);
      const parentText = parentEv ? parentEv.content.replace(/\n/g, ' ') : "取得中...";
      const parentP = parentEv ? this.profiles.get(parentEv.pubkey) : null;
      const parentImg = parentP?.picture || DEFAULT_CONFIG.defaultIcon;
      
      replyContextHtml = `
        <div class="reply-context" onclick="app.openThread('${replyId}'); event.stopPropagation();">
          <img src="${this.esc(parentImg)}">
          <span class="snippet">Replying to: ${this.esc(parentText)}</span>
        </div>
      `;
      if (!parentEv) this.fetchSingleEvent(replyId);
    }

    const html = `
      <div class="post" id="post-${ev.id}" onclick="app.openThread('${ev.id}')">
        <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">
        <div class="post-content">
          <div class="post-header" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();">
            <span class="user-name pubkey-${ev.pubkey}">${this.esc(dName)}${badgeHtml}</span>
            <span class="user-id nip05-${ev.pubkey}">${this.esc(sName)}</span>
          </div>
          ${replyContextHtml}
          <div class="post-text">${this.esc(ev.content)}</div>
          <div class="post-actions">
            <button class="action-btn" onclick="app.openThread('${ev.id}'); event.stopPropagation();">💬</button>
            <button class="action-btn heart-btn ${isLiked ? 'liked' : ''}" onclick="app.toggleLike('${ev.id}', '${ev.pubkey}'); event.stopPropagation();">
              ${isLiked ? '♥' : '♡'}
            </button>
          </div>
        </div>
      </div>
    `;
    
    if (!document.getElementById(`post-${ev.id}`)) {
      if (prepend) container.insertAdjacentHTML('afterbegin', html);
      else container.insertAdjacentHTML('beforeend', html);
    }

    if (!this.profiles.has(ev.pubkey)) {
      this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
    }
  },

  renderNotification(ev, prepend) {
    const container = document.getElementById('timeline-notifications');
    if (!container) return;
    
    // いいねの場合
    if (ev.kind === 7) {
      const eTag = ev.tags.find(t => t[0] === 'e');
      const targetId = eTag ? eTag[1] : null;
      const profile = this.profiles.get(ev.pubkey) || {};
      const targetEv = this.eventStorage.get(targetId);
      const snippet = targetEv ? targetEv.content.replace(/\n/g, ' ') : "あなたの投稿";
      
      const pubkeyHex = ev.pubkey.slice(0, 8) + '...';
      let dName = profile.display_name || profile.name || "誰か";
      let sName = "@" + (profile.name || pubkeyHex);

      const html = `
        <div class="post" onclick="app.openThread('${targetId}')">
          <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">
          <div class="post-content">
            <div class="post-header">
              <span class="user-name pubkey-${ev.pubkey}">${this.esc(dName)}</span>
              <span class="user-id nip05-${ev.pubkey}">${this.esc(sName)}</span>
              <span style="margin-left: 5px; font-size: 14px; color: var(--text-sub);">さんがいいねしました ❤️</span>
            </div>
            <div class="reply-context"><span class="snippet">${this.esc(snippet)}</span></div>
          </div>
        </div>
      `;
      if (prepend) container.insertAdjacentHTML('afterbegin', html);
      else container.insertAdjacentHTML('beforeend', html);
      
      if (!this.profiles.has(ev.pubkey)) this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
      if (!targetEv && targetId) this.fetchSingleEvent(targetId);
    } 
    // 返信・メンションの場合
    else if (ev.kind === 1) {
      this.renderPost(ev, prepend, 'timeline-notifications');
    }
  },

  fetchSingleEvent(id) {
    this.query([{ ids: [id] }], (ev) => {
      this.eventStorage.set(ev.id, ev);
      const els = document.querySelectorAll('.snippet');
      els.forEach(el => {
        if(el.innerText.includes("取得中...")) el.innerText = `Replying to: ${ev.content.replace(/\n/g, ' ')}`;
      });
    });
  },

  updateUIPost(pubkey) {
    const p = this.profiles.get(pubkey);
    if (!p) return;
    
    const pubkeyHex = pubkey.slice(0, 8) + '...';
    let dName = p.display_name || p.name || "npub...";
    let sName = "@" + (p.name || pubkeyHex);

    const status = this.nip05Status.get(p.nip05);
    let badgeHtml = status === true ? ` <span class="badge" title="Verified">✅</span>` : (status === false ? ` <span class="badge" title="Invalid">⚠️</span>` : "");

    document.querySelectorAll(`.post`).forEach(el => {
      if (el.innerHTML.includes(`openProfile('${pubkey}')`)) {
        const img = el.querySelector('.avatar-sm');
        const nameEl = el.querySelector(`.pubkey-${pubkey}`);
        const idEl = el.querySelector(`.nip05-${pubkey}`);
        if (img && p.picture) img.src = this.esc(p.picture);
        if (nameEl) nameEl.innerHTML = this.esc(dName) + badgeHtml;
        if (idEl) idEl.innerText = this.esc(sName);
      }
    });
  },

  async verifyNip05(nip05, pubkey) {
    if (this.nip05Status.has(nip05)) return;
    this.nip05Status.set(nip05, 'pending');
    try {
      const [name, domain] = nip05.split('@');
      const res = await fetch(`https://${domain}/.well-known/nostr.json?name=${name}`);
      const data = await res.json();
      const isValid = data.names && data.names[name] === pubkey;
      this.nip05Status.set(nip05, isValid);
      this.updateUIPost(pubkey);
    } catch {
      this.nip05Status.set(nip05, false);
      this.updateUIPost(pubkey);
    }
  },

  fetchProfile(pubkey, cb) {
    if (this.profiles.has(pubkey)) return cb(this.profiles.get(pubkey));
    this.query([{ kinds: [0], authors: [pubkey], limit: 1 }], (ev) => {
      try {
        const data = JSON.parse(ev.content);
        this.profiles.set(pubkey, data);
        cb(data);
      } catch(e) {}
    });
  },

  openProfile(pubkey) {
    if (!pubkey) return;
    this.currentProfilePubkey = pubkey;
    
    document.getElementById('profile-name').innerHTML = "Loading...";
    document.getElementById('profile-pubkey').innerText = "";
    document.getElementById('profile-about').innerText = "";
    document.getElementById('profile-avatar').src = DEFAULT_CONFIG.defaultIcon;
    document.getElementById('profile-banner').style.backgroundImage = 'none';
    document.getElementById('timeline-profile').innerHTML = "";
    this.state.profile = { newest: 0, oldest: Math.floor(Date.now()/1000) };
    
    this.switchTab('profile');

    this.fetchProfile(pubkey, (p) => {
      const pubkeyHex = pubkey.slice(0, 8) + '...';
      let dName = p.display_name || p.name || "npub...";
      let sName = "@" + (p.name || pubkeyHex);
      
      const status = this.nip05Status.get(p.nip05);
      let badgeHtml = status === true ? ` <span class="badge">✅</span>` : (status === false ? ` <span class="badge">⚠️</span>` : "");
      
      document.getElementById('profile-name').innerHTML = `${this.esc(dName)}${badgeHtml}`;
      document.getElementById('profile-pubkey').innerText = sName;
      document.getElementById('profile-about').innerText = p.about || "";
      if (p.picture) document.getElementById('profile-avatar').src = p.picture;
      if (p.banner) document.getElementById('profile-banner').style.backgroundImage = `url(${this.esc(p.banner)})`;
      
      if (p.nip05 && status === undefined) {
        this.verifyNip05(p.nip05, pubkey).then(() => this.openProfile(pubkey));
      }
    });

    this.fetchFeed('older');
  },

  openThread(eventId) {
    if (!eventId) return;
    this.previousTab = this.activeTab === 'thread' ? this.previousTab : this.activeTab;
    this.currentThreadId = eventId;
    this.state.thread = { newest: 0, oldest: Math.floor(Date.now()/1000) };
    
    document.getElementById('thread-main-post').innerHTML = "";
    document.getElementById('timeline-thread').innerHTML = "";
    
    this.switchTab('thread');

    const parentEv = this.eventStorage.get(eventId);
    if (parentEv) {
      this.renderPost(parentEv, true, 'thread-main-post');
    } else {
      this.query([{ ids: [eventId] }], (ev) => {
        this.eventStorage.set(ev.id, ev);
        this.renderPost(ev, true, 'thread-main-post');
      });
    }

    this.fetchFeed('older');
  },

  openMutelist() {
    if (!this.currentProfilePubkey) return;
    document.getElementById('list-mutelist').innerHTML = "読み込み中...";
    this.switchTab('mutelist');

    this.query([{ kinds: [10000], authors: [this.currentProfilePubkey], limit: 1 }], (ev) => {
      const mutedPubkeys = ev.tags.filter(t => t[0] === 'p').map(t => t[1]);
      document.getElementById('list-mutelist').innerHTML = "";
      
      if (mutedPubkeys.length === 0) {
        document.getElementById('list-mutelist').innerHTML = "<div style='padding: 15px;'>ミュートしているユーザーはいません。</div>";
        return;
      }

      mutedPubkeys.forEach(pk => {
        this.fetchProfile(pk, (p) => {
          let name = p.display_name || p.name || "npub...";
          const html = `
            <div class="post" onclick="app.openProfile('${pk}')">
              <img src="${this.esc(p.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm">
              <div class="post-content">
                <div class="user-name pubkey-${pk}">${this.esc(name)}</div>
              </div>
            </div>`;
          document.getElementById('list-mutelist').insertAdjacentHTML('beforeend', html);
        });
      });
    });
  },

  async toggleLike(id, pubkey) {
    if (!this.myPubkey) return alert("ログインしてください");
    if (this.likedIds.has(id)) return;

    const ev = { kind: 7, created_at: Math.floor(Date.now()/1000), tags: [["e", id], ["p", pubkey]], content: "+" };
    try {
      const signed = await window.nostr.signEvent(ev);
      this.broadcast(signed);
      this.likedIds.add(id);
      document.querySelectorAll(`#post-${id} .heart-btn`).forEach(btn => {
        btn.innerHTML = '♥';
        btn.classList.add('liked');
      });
    } catch(e) { console.error(e); }
  },

  copyNpub() {
    if (!this.currentProfilePubkey) return;
    let npub = this.currentProfilePubkey;
    try {
      if (window.NostrTools && window.NostrTools.nip19) {
        npub = window.NostrTools.nip19.npubEncode(this.currentProfilePubkey);
      }
    } catch(e){}
    
    navigator.clipboard.writeText(npub).then(() => alert("コピーしました:\n" + npub));
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.timeline, #page-setting, #post-area, #page-profile, #page-thread, #page-mutelist').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
    
    const navEl = document.getElementById(`nav-${tab}`);
    if (navEl) navEl.classList.add('active');

    const titles = { public: 'グローバル', home: 'ホーム', notifications: '通知', setting: '設定', profile: 'プロフィール', thread: 'スレッド', mutelist: 'ミュートリスト' };
    document.getElementById('header-title').innerText = titles[tab] || '';

    if (tab === 'setting') document.getElementById('page-setting').classList.remove('hidden');
    else if (tab === 'profile') {
      document.getElementById('page-profile').classList.remove('hidden');
      document.getElementById('timeline-profile').classList.remove('hidden');
    } else if (tab === 'thread') {
      document.getElementById('page-thread').classList.remove('hidden');
    } else if (tab === 'mutelist') {
      document.getElementById('page-mutelist').classList.remove('hidden');
    } else {
      document.getElementById(`timeline-${tab}`).classList.remove('hidden');
      if (tab === 'home' || tab === 'public') document.getElementById('post-area').classList.remove('hidden');
      
      if (document.getElementById(`timeline-${tab}`).children.length === 0) {
        this.fetchFeed('older');
      }
    }
  },

  saveSettings() {
    localStorage.setItem('nostr_relays', document.getElementById('relay-input').value);
    localStorage.setItem('nostr_batch_size', document.getElementById('batch-input').value);
    location.reload();
  },

  esc(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
};

app.init();
