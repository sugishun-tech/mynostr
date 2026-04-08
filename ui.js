import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

app.esc = function(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};

app.updateBatchDisplay = function() {
  document.querySelectorAll('.batch-num').forEach(el => el.innerText = this.batchSize);
};

app.renderPost = function(ev, prepend, targetContainerId = null) {
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
};

app.renderNotification = function(ev, prepend) {
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
};

app.updateUIPost = function(pubkey) {
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
};

app.openProfile = function(pubkey) {
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
};

app.openThread = function(eventId) {
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
};

app.openMutelist = function() {
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
};

app.switchTab = function(tab) {
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
};
