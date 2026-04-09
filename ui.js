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
  if (container.querySelector(`[data-event-id="${ev.id}"]`)) return;

  const profile = this.profiles.get(ev.pubkey) || {};
  const isLiked = this.likedIds ? this.likedIds.has(ev.id) : false;
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

  // --- 💡返信をわかりやすくする機能 ---
  let replyContextHtml = '';
  let parentId = null;
  const eTags = ev.tags ? ev.tags.filter(t => t[0] === 'e') : [];
  if (eTags.length > 0) {
    // リプライマーカーがあるもの、なければ最後のeタグを親とする
    const replyTag = eTags.find(t => t.length > 3 && t[3] === 'reply') || eTags[eTags.length - 1];
    parentId = replyTag[1];
  }

  if (parentId && containerId !== 'thread-parent-post') {
    const parentEv = this.eventStorage ? this.eventStorage.get(parentId) : null;
    if (parentEv) {
      const pProfile = this.profiles.get(parentEv.pubkey) || {};
      const pName = pProfile.display_name || pProfile.name || "npub...";
      const snippet = parentEv.content.replace(/\n/g, ' ').substring(0, 40) + '...';
      replyContextHtml = `
        <div class="reply-context preview" onclick="if(!window.getSelection().toString()) { app.openThread('${parentId}'); } event.stopPropagation();">
          <img src="${this.esc(pProfile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-tiny" loading="lazy">
          <span class="snippet">${this.esc(pName)} - ${this.esc(snippet)}</span>
        </div>
      `;
    } else {
      // 親イベント未取得の場合はプレースホルダーを表示
      replyContextHtml = `
        <div class="reply-context preview" id="reply-preview-${ev.id}" onclick="if(!window.getSelection().toString()) { app.openThread('${parentId}'); } event.stopPropagation();">
          <span class="snippet">返信元を取得中...</span>
        </div>
      `;
      // 非同期で取得
      if (this.query) {
        this.query([{ ids: [parentId] }], (pEv) => {
          if (this.eventStorage) this.eventStorage.set(pEv.id, pEv);
          if (!this.profiles.has(pEv.pubkey)) {
            this.fetchProfile(pEv.pubkey, () => this.updateReplyPreview(ev.id, pEv));
          } else {
            this.updateReplyPreview(ev.id, pEv);
          }
        });
      }
    }
  }

  // --- 💡コピペ対策 (onclick に window.getSelection() の判定を追加) ---
  const html = `
    <div class="post" data-event-id="${ev.id}" data-timestamp="${ev.created_at}" onclick="if(!window.getSelection().toString()) { app.openThread('${ev.id}'); }">
      <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">
      <div class="post-content">
        ${replyContextHtml}
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

  const children = Array.from(container.children);
  const nextElement = children.find(child => {
    const childTime = parseInt(child.getAttribute('data-timestamp'));
    return ev.created_at > childTime;
  });

  if (nextElement && !prepend) {
    container.insertBefore(this.createHTMLElement(html), nextElement);
  } else if (prepend) {
    container.insertAdjacentHTML('afterbegin', html);
  } else {
    container.insertAdjacentHTML('beforeend', html);
  }

  if (!this.profiles.has(ev.pubkey)) {
    this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
  }
};


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

app.updateReplyPreview = function(childId, parentEv) {
  const el = document.getElementById(`reply-preview-${childId}`);
  if (!el) return;
  const pProfile = this.profiles.get(parentEv.pubkey) || {};
  const pName = pProfile.display_name || pProfile.name || "npub...";
  const snippet = parentEv.content.replace(/\n/g, ' ').substring(0, 40) + '...';
  
  el.innerHTML = `
    <img src="${this.esc(pProfile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-tiny" loading="lazy">
    <span class="snippet">${this.esc(pName)} - ${this.esc(snippet)}</span>
  `;
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
  const url = `https://sugishun-tech.github.io/mynostr_profile/?hex=${pubkey}`;
  window.open(url, '_blank');
};

app.openThread = function(eventId) {
  if (!eventId) return;
  this.previousTab = this.activeTab === 'thread' ? this.previousTab : this.activeTab;
  this.currentThreadId = eventId;
  if(this.state) this.state.thread = { newest: 0, oldest: Math.floor(Date.now()/1000) };
  
  document.getElementById('thread-parent-post').innerHTML = "";
  document.getElementById('thread-main-post').innerHTML = "";
  document.getElementById('timeline-thread').innerHTML = "";
  
  this.switchTab('thread');

  const renderThreadContext = (ev) => {
    // 中心となる投稿
    this.renderPost(ev, true, 'thread-main-post');
    
    // 1. 上一階層（親）の取得と表示
    let parentId = null;
    const eTags = ev.tags ? ev.tags.filter(t => t[0] === 'e') : [];
    if (eTags.length > 0) {
      const replyTag = eTags.find(t => t.length > 3 && t[3] === 'reply') || eTags[eTags.length - 1];
      parentId = replyTag[1];
    }
    
    if (parentId && this.query) {
      const parentEv = this.eventStorage.get(parentId);
      if (parentEv) {
        this.renderPost(parentEv, true, 'thread-parent-post');
      } else {
        this.query([{ ids: [parentId] }], (pEv) => {
          if(this.eventStorage) this.eventStorage.set(pEv.id, pEv);
          this.renderPost(pEv, true, 'thread-parent-post');
        });
      }
    }

    // 2. 下一階層（子・リプライ）の取得と表示
    if (this.query) {
      this.query([{ kinds: [1], '#e': [ev.id] }], (childEv) => {
        if(this.eventStorage) this.eventStorage.set(childEv.id, childEv);
        this.renderPost(childEv, false, 'timeline-thread');
      });
    }
  };

  const parentEv = this.eventStorage ? this.eventStorage.get(eventId) : null;
  if (parentEv) {
    renderThreadContext(parentEv);
  } else if(this.query) {
    this.query([{ ids: [eventId] }], (ev) => {
      if(this.eventStorage) this.eventStorage.set(ev.id, ev);
      renderThreadContext(ev);
    });
  }
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
    
    if (document.getElementById(`timeline-${tab}`).children.length === 0 && this.fetchFeed) {
      this.fetchFeed('older');
    }
  }
};
