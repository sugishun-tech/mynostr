import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

// 投稿の描画（タイムラインへの挿入）
app.renderPost = function(ev, _prependIgnore, targetContainerId = null) {
  const containerId = targetContainerId || `timeline-${this.activeTab}`;
  const container = document.getElementById(containerId);
  if (!container) return;

  if (ev.kind === 7 && containerId !== 'timeline-notifications') return;
  if (container.querySelector(`[data-event-id="${ev.id}"]`)) return;

  const profile = this.profiles.get(ev.pubkey) || {};
  const isLiked = this.likedIds ? this.likedIds.has(ev.id) : false;
  const timeStr = this.formatTime(ev.created_at);
  
  const dName = profile.display_name || profile.name || "npub...";
  const sName = "@" + (profile.name || ev.pubkey.slice(0, 8) + '...');
  
  let badgeHtml = "";
  if (profile.nip05) {
    const status = this.nip05Status.get(profile.nip05);
    if (status === true) badgeHtml = `<span class="badge" title="Verified">✅</span>`;
    else if (status === false) badgeHtml = `<span class="badge" title="Invalid">⚠️</span>`;
    else this.verifyNip05(profile.nip05, ev.pubkey);
  }

  // リプライコンテキスト生成
  let replyContextHtml = '';
  let parentId = null;
  const eTags = ev.tags ? ev.tags.filter(t => t[0] === 'e') : [];
  
  if (eTags.length > 0) {
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
        </div>`;
    } else {
      replyContextHtml = `
        <div class="reply-context preview" id="reply-preview-${ev.id}" onclick="if(!window.getSelection().toString()) { app.openThread('${parentId}'); } event.stopPropagation();">
          <span class="snippet">返信元を取得中...</span>
        </div>`;
      if (this.fetchEventBatched) {
        this.fetchEventBatched(parentId, (pEv) => {
          if (!pEv) return;
          if (!this.profiles.has(pEv.pubkey)) {
            this.fetchProfile(pEv.pubkey, () => this.updateReplyPreview(ev.id, pEv));
          } else {
            this.updateReplyPreview(ev.id, pEv);
          }
        });
      }
    }
  }

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
    </div>`;

  const newPostEl = this.createHTMLElement(html);
  const children = Array.from(container.children);
  const nextElement = children.find(child => {
    const childTime = parseInt(child.getAttribute('data-timestamp'));
    const childId = child.getAttribute('data-event-id');
    if (ev.created_at > childTime) return true;
    if (ev.created_at === childTime) return ev.id > childId;
    return false;
  });

  if (nextElement) container.insertBefore(newPostEl, nextElement);
  else container.appendChild(newPostEl);

  if (!this.profiles.has(ev.pubkey)) {
    this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
  }
};

// 通知の描画
app.renderNotification = function(ev) {
  const container = document.getElementById('timeline-notifications');
  if (!container || container.querySelector(`[data-event-id="${ev.id}"]`)) return;
  
  if (ev.kind === 7) {
    const eTag = ev.tags.find(t => t[0] === 'e');
    const targetId = eTag ? eTag[1] : null;
    const profile = this.profiles.get(ev.pubkey) || {};
    const targetEv = this.eventStorage ? this.eventStorage.get(targetId) : null;
    const snippet = targetEv ? targetEv.content.replace(/\n/g, ' ') : "あなたの投稿";
    
    const dName = profile.display_name || profile.name || "誰か";
    const sName = "@" + (profile.name || ev.pubkey.slice(0, 8) + '...');

    const html = `
      <div class="post" data-event-id="${ev.id}" data-timestamp="${ev.created_at}" onclick="app.openThread('${targetId}')">
        <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">
        <div class="post-content">
          <div class="post-header">
            <span class="user-name pubkey-${ev.pubkey}">${this.esc(dName)}</span>
            <span class="user-id nip05-${ev.pubkey}">${this.esc(sName)}</span>
            <span style="margin-left: 5px; font-size: 14px; color: var(--text-sub);">さんがいいねしました ❤️</span>
          </div>
          <div class="reply-context"><span class="snippet">${this.esc(snippet)}</span></div>
        </div>
      </div>`;
    
    const newPostEl = this.createHTMLElement(html);
    const children = Array.from(container.children);
    const nextElement = children.find(child => {
      const childTime = parseInt(child.getAttribute('data-timestamp'));
      if (ev.created_at > childTime) return true;
      if (ev.created_at === childTime) return ev.id > child.getAttribute('data-event-id');
      return false;
    });

    if (nextElement) container.insertBefore(newPostEl, nextElement);
    else container.appendChild(newPostEl);

    if (!this.profiles.has(ev.pubkey)) this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
    if (!targetEv && targetId) this.fetchSingleEvent(targetId);
  } 
  else if (ev.kind === 1) {
    this.renderPost(ev, false, 'timeline-notifications');
  }
};

// UIの事後更新（リプライ先、プロフィール等）
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
  
  const dName = p.display_name || p.name || "npub...";
  const sName = "@" + (p.name || pubkey.slice(0, 8) + '...');
  const status = this.nip05Status.get(p.nip05);
  const badgeHtml = status === true ? ` <span class="badge" title="Verified">✅</span>` : (status === false ? ` <span class="badge" title="Invalid">⚠️</span>` : "");

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
