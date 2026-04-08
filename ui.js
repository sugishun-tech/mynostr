import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

app.esc = function(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};

app.updateBatchDisplay = function() {
  document.querySelectorAll('.batch-num').forEach(el => el.innerText = this.batchSize);
};


app.formatTime = function(unix) {
  const date = new Date(unix * 1000);
  
  const Y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const D = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');

  return `${Y}/${M}/${D} ${h}:${m}:${s}`;
};

app.renderPost = function(ev, prepend, targetContainerId = null) {
  const containerId = targetContainerId || `timeline-${this.activeTab}`;
  const container = document.getElementById(containerId);
  if (!container) return;

  if (ev.kind === 7 && containerId !== 'timeline-notifications') return;
  //if (document.getElementById(`post-${ev.id}`)) return; // 重複チェック
  if (container.querySelector(`[data-event-id="${ev.id}"]`)) return;

  const profile = this.profiles.get(ev.pubkey) || {};
  const isLiked = this.likedIds.has(ev.id);
  const timeStr = this.formatTime(ev.created_at);
  
  let dName = profile.display_name || profile.name || "npub...";
  let sName = "@" + (profile.name || ev.pubkey.slice(0, 8) + '...');
  
  let badgeHtml = "";
  if (profile.nip05) {
    const status = this.nip05Status.get(profile.nip05);
    if (status === true) badgeHtml = `<span class="badge" title="Verified">✅</span>`;
    else if (status === false) badgeHtml = `<span class="badge" title="Invalid">⚠️</span>`;
    else this.verifyNip05(profile.nip05, ev.pubkey);
  }

  // --- HTML組み立て (タイムスタンプ追加) ---
  const html = `
    <div class="post" data-event-id="${ev.id}" data-timestamp="${ev.created_at}" onclick="app.openThread('${ev.id}')">
      <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">\
      <div class="post-content">
        <div class="post-header">
          <div class="header-user-info" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();">
            <span class="user-name pubkey-${ev.pubkey}">${this.esc(dName)}${badgeHtml}</span>
            <span class="user-id nip05-${ev.pubkey}">${this.esc(sName)}</span>
          </div>
          <span class="post-time" title="${new Date(ev.created_at * 1000).toLocaleString()}">· ${timeStr}</span>
        </div>
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

  // --- 時系列ソート挿入ロジック ---
  const children = Array.from(container.children);
  const nextElement = children.find(child => {
    const childTime = parseInt(child.getAttribute('data-timestamp'));
    return ev.created_at > childTime; // 自分より古い要素を見つける
  });

  if (nextElement) {
    container.insertBefore(this.createHTMLElement(html), nextElement);
  } else {
    container.insertAdjacentHTML('beforeend', html);
  }

  // プロフィール取得などは既存のまま
  if (!this.profiles.has(ev.pubkey)) {
    this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
  }
};

// 文字列をDOM要素に変換するヘルパー
app.createHTMLElement = function(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstChild;
};

app.renderNotification = function(ev, prepend) {
  const container = document.getElementById('timeline-notifications');
  if (!container) return;
  if (container.querySelector(`[data-event-id="${ev.id}"]`)) return;
  
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
      <div class="post" data-event-id="${ev.id}" onclick="app.openThread('${targetId}')">
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
  return 
  //if (!pubkey) return;
  //const npub = this.hexToNpub(pubkey);
  //const url = `https://nostter.app/${npub}`;
  //window.open(url, '_blank');
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

app.switchTab = function(tab) {
  this.activeTab = tab;
  document.querySelectorAll('.timeline, #page-setting, #post-area, #page-profile, #page-thread, #page-mutelist').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
  
  const navEl = document.getElementById(`nav-${tab}`);
  if (navEl) navEl.classList.add('active');

  const titles = { public: 'グローバル', home: 'ホーム', notifications: '通知', setting: '設定', thread: 'スレッド'};
  document.getElementById('header-title').innerText = titles[tab] || '';

  if (tab === 'setting') {
    document.getElementById('page-setting').classList.remove('hidden');
  } else if (tab === 'thread') {
    document.getElementById('page-thread').classList.remove('hidden');
  } else {
    document.getElementById(`timeline-${tab}`).classList.remove('hidden');
    if (tab === 'home' || tab === 'public') document.getElementById('post-area').classList.remove('hidden');
    
    if (document.getElementById(`timeline-${tab}`).children.length === 0) {
      this.fetchFeed('older');
    }
  }
};
