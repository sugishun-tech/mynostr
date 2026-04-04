// 1. システム設定 (config.jsonの代替)
const DEFAULT_CONFIG = {
  relays: [
    "wss://relay.nostr.band/",
    "wss://nos.lol/",
    "wss://relay.damus.io/",
    "wss://relay-jp.nostr.wirednet.jp/",
    "wss://yabu.me/",
    "wss://r.kojira.io/",
    "wss://nrelay-jp.c-stellar.net/",
  ],
  batchSize: 30,
  defaultIcon: "https://void.cat/d/H9k1GvE3z7rWqB3vY5Q2rK.webp" // 適当なデフォルトアイコン
};

const app = {
  myPubkey: "",
  relays: [],
  eventStorage: new Map(), // 重複排除用
  profiles: new Map(),     // プロフィールキャッシュ
  likedIds: new Set(),     // 自分がいいねしたID
  following: new Set(),    // フォローリスト
  subscriptions: new Map(), // ★修正: Listenerリークを防ぐためのSub管理
  activeTab: 'public',
  currentProfilePubkey: null,
  
  // 各タブのタイムスタンプ境界
  state: {
    public:  { newest: 0, oldest: Math.floor(Date.now()/1000) },
    home:    { newest: 0, oldest: Math.floor(Date.now()/1000) },
    profile: { newest: 0, oldest: Math.floor(Date.now()/1000) }
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
      ws.onopen = () => console.log(`Connected: ${url}`);
      ws.onerror = () => console.warn(`Relay failed: ${url}`);
      
      // ★修正: リスナーはここで1度だけ登録する（メモリリーク防止）
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

  // ログイン処理
  async login() {
    if (!window.nostr) return alert("NIP-07拡張機能（nos2x等）が見つかりません");
    try {
      this.myPubkey = await window.nostr.getPublicKey();
      document.getElementById('login-btn').classList.add('hidden');
      document.getElementById('profile-display').classList.remove('hidden');
      document.getElementById('post-avatar').classList.remove('hidden');
      
      this.fetchProfile(this.myPubkey, (p) => {
        document.getElementById('my-name').innerText = p.name || "User";
        const iconUrl = p.picture || DEFAULT_CONFIG.defaultIcon;
        document.getElementById('my-pic').src = iconUrl;
        document.getElementById('post-avatar').src = iconUrl;
      });
      
      // フォローリスト取得
      this.query([{ kinds: [3], authors: [this.myPubkey], limit: 1 }], (ev) => {
        this.following = new Set(ev.tags.filter(t => t[0] === 'p').map(t => t[1]));
        if(this.activeTab === 'home') this.fetchFeed('older');
      });
    } catch (e) { console.error("Login failed:", e); }
  },

  // ★追加: 投稿機能
  async submitPost() {
    if (!this.myPubkey) return alert("ログインが必要です");
    const inputArea = document.getElementById('post-input');
    const content = inputArea.value.trim();
    if (!content) return;

    const event = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: content
    };

    try {
      const signedEvent = await window.nostr.signEvent(event);
      this.relays.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(["EVENT", signedEvent]));
        }
      });
      inputArea.value = '';
      
      // 自身の投稿をローカルで即座にHomeへ反映
      if (this.activeTab === 'home' || this.activeTab === 'public') {
        this.eventStorage.set(signedEvent.id, signedEvent);
        this.renderPost(signedEvent, true);
      }
    } catch (e) {
      alert("投稿に失敗しました");
      console.error(e);
    }
  },

  // フィード取得
  fetchFeed(direction) {
    const tab = this.activeTab;
    const state = this.state[tab];
    let filter = { kinds: [1] };

    if (tab === 'home') {
      if (!this.myPubkey) {
        alert("ログインが必要です");
        return;
      }
      filter.authors = [this.myPubkey, ...Array.from(this.following)];
      if (filter.authors.length === 0) return; // フォロー0の場合のエラー回避
    } else if (tab === 'profile') {
      if (!this.currentProfilePubkey) return;
      filter.authors = [this.currentProfilePubkey];
    }

    if (direction === 'latest') {
      filter.since = state.newest + 1;
    } else if (direction === 'newer') {
      filter.since = state.newest + 1;
      filter.limit = this.batchSize;
    } else if (direction === 'older') {
      filter.until = state.oldest - 1;
      filter.limit = this.batchSize;
    }

    this.query([filter], (event) => {
      if (this.eventStorage.has(event.id)) return;
      this.eventStorage.set(event.id, event);
      
      state.newest = Math.max(state.newest, event.created_at);
      state.oldest = Math.min(state.oldest, event.created_at);

      this.renderPost(event, direction !== 'older');
    });
  },

  // ★修正: リスナーを共有するためのSubscription管理
  query(filters, onEvent) {
    const subId = "sub_" + Math.random().toString(36).substring(7);
    this.subscriptions.set(subId, onEvent);

    this.relays.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(["REQ", subId, ...filters]));
      }
    });

    // 4秒後に購読を閉じてメモリ解放
    setTimeout(() => {
      this.relays.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
      });
      this.subscriptions.delete(subId);
    }, 4000);
  },

  renderPost(ev, prepend) {
    // 現在のタブが home, public, profile のいずれかでなければ無視
    const container = document.getElementById(`timeline-${this.activeTab}`);
    if (!container) return;

    const profile = this.profiles.get(ev.pubkey) || {};
    const isLiked = this.likedIds.has(ev.id);
    const pubkeyHex = ev.pubkey.slice(0, 8) + '...';

    const html = `
      <div class="post" id="post-${ev.id}">
        <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">
        <div class="post-content">
          <div class="post-header" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();">
            <span class="user-name">${this.esc(profile.name || pubkeyHex)}</span>
            <span class="user-id">@${pubkeyHex}</span>
          </div>
          <div class="post-text">${this.esc(ev.content)}</div>
          <div class="post-actions">
            <button class="heart-btn ${isLiked ? 'liked' : ''}" onclick="app.toggleLike('${ev.id}', '${ev.pubkey}'); event.stopPropagation();">
              ${isLiked ? '♥' : '♡'}
            </button>
          </div>
        </div>
      </div>
    `;
    
    if (prepend) container.insertAdjacentHTML('afterbegin', html);
    else container.insertAdjacentHTML('beforeend', html);

    if (!this.profiles.has(ev.pubkey)) {
      this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
    }
  },

  updateUIPost(pubkey) {
    const p = this.profiles.get(pubkey);
    document.querySelectorAll(`.post`).forEach(el => {
      // 簡易的な要素特定
      if (el.innerHTML.includes(`openProfile('${pubkey}')`)) {
        const img = el.querySelector('.avatar-sm');
        const name = el.querySelector('.user-name');
        if (img && p.picture) img.src = this.esc(p.picture);
        if (name && p.name) name.innerText = this.esc(p.name);
      }
    });
  },

  fetchProfile(pubkey, cb) {
    this.query([{ kinds: [0], authors: [pubkey], limit: 1 }], (ev) => {
      try {
        const data = JSON.parse(ev.content);
        this.profiles.set(pubkey, data);
        cb(data);
      } catch(e) {}
    });
  },

  // ★追加: プロフィール画面を開く
  openProfile(pubkey) {
    if (!pubkey) return;
    this.currentProfilePubkey = pubkey;
    
    // プロフィール表示の初期化
    document.getElementById('profile-name').innerText = "Loading...";
    document.getElementById('profile-pubkey').innerText = `@${pubkey.slice(0, 12)}...`;
    document.getElementById('profile-about').innerText = "";
    document.getElementById('profile-avatar').src = DEFAULT_CONFIG.defaultIcon;
    document.getElementById('profile-banner').style.backgroundImage = 'none';
    document.getElementById('timeline-profile').innerHTML = "";
    
    // 状態をリセット
    this.state.profile = { newest: 0, oldest: Math.floor(Date.now()/1000) };
    
    this.switchTab('profile');

    // プロフィール情報取得
    this.fetchProfile(pubkey, (p) => {
      document.getElementById('profile-name').innerText = p.name || "User";
      document.getElementById('profile-about').innerText = p.about || "";
      if (p.picture) document.getElementById('profile-avatar').src = p.picture;
      if (p.banner) document.getElementById('profile-banner').style.backgroundImage = `url(${this.esc(p.banner)})`;
    });

    // プロフィール投稿履歴取得
    this.fetchFeed('older');
  },

  async toggleLike(id, pubkey) {
    if (!this.myPubkey) return alert("ログインしてください");
    if (this.likedIds.has(id)) return;

    const ev = {
      kind: 7,
      created_at: Math.floor(Date.now()/1000),
      tags: [["e", id], ["p", pubkey]],
      content: "+"
    };
    
    try {
      const signed = await window.nostr.signEvent(ev);
      this.relays.forEach(ws => {
        if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["EVENT", signed]));
      });
      
      this.likedIds.add(id);
      const btn = document.querySelector(`#post-${id} .heart-btn`);
      if (btn) {
        btn.innerHTML = '♥';
        btn.classList.add('liked');
      }
    } catch(e) {
      console.error(e);
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.timeline, #page-setting, #post-area, #page-profile').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
    
    const navEl = document.getElementById(`nav-${tab}`);
    if (navEl) navEl.classList.add('active');

    const titles = { public: 'Global Timeline', home: 'Home', setting: 'Settings', profile: 'Profile' };
    document.getElementById('header-title').innerText = titles[tab] || '';

    if (tab === 'setting') {
      document.getElementById('page-setting').classList.remove('hidden');
    } else if (tab === 'profile') {
      document.getElementById('page-profile').classList.remove('hidden');
      document.getElementById('timeline-profile').classList.remove('hidden');
    } else {
      document.getElementById(`timeline-${tab}`).classList.remove('hidden');
      if (tab === 'home') document.getElementById('post-area').classList.remove('hidden');
      
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
