import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

// 投稿の描画（タイムラインへの挿入）
app.renderPost = function(ev, _prependIgnore, targetContainerId = null) {
  if (!ev || !this.isValidEventId(ev.id) || !this.isValidEventId(ev.pubkey)) return;

  const containerId = targetContainerId || `timeline-${this.getCurrentTab()}`;
  const container = document.getElementById(containerId);
  if (!container) return;

  if (ev.kind === 7 && containerId !== 'timeline-notifications') return;
  if (container.querySelector(`[data-event-id="${ev.id}"]`)) return;
  if (this.eventStorage) this.eventStorage.set(ev.id, ev);

  const profile = this.profiles.get(ev.pubkey) || {};
  const isLiked = this.likedIds ? this.likedIds.has(ev.id) : false;
  const timeStr = this.formatTime(ev.created_at);
  const clientLabelHtml = this.getClientLabelHtml ? this.getClientLabelHtml(ev) : '';
  const threadHref = this.getThreadPermalink(ev.id);
  
  const dName = profile.display_name || profile.name || "npub...";
  const sName = "@" + (profile.name || ev.pubkey.slice(0, 8) + '...');
  
  let badgeHtml = "";
  /*if (profile.nip05) {
    const status = this.nip05Status.get(profile.nip05);
    if (status === true) badgeHtml = `<span class="badge" title="Verified">✅</span>`;
    else if (status === false) badgeHtml = `<span class="badge" title="Invalid">⚠️</span>`;
    else this.verifyNip05(profile.nip05, ev.pubkey);
  }*/

  // リプライコンテキスト生成
  let replyContextHtml = '';
  let parentId = null;
  const eTags = ev.tags ? ev.tags.filter(t => t[0] === 'e') : [];
  
  if (eTags.length > 0) {
    const replyTag = eTags.find(t => t.length > 3 && t[3] === 'reply') || eTags[eTags.length - 1];
    if (replyTag && this.isValidEventId(replyTag[1])) parentId = replyTag[1].toLowerCase();
  }

  if (parentId && containerId !== 'thread-parent-post') {
    const parentEv = this.eventStorage ? this.eventStorage.get(parentId) : null;
    const parentHref = this.getThreadPermalink(parentId);
    if (parentEv) {
      const pProfile = this.profiles.get(parentEv.pubkey) || {};
      const pName = pProfile.display_name || pProfile.name || "npub...";
      const snippet = parentEv.content.replace(/\n/g, ' ').substring(0, 40) + '...';
      replyContextHtml = `
        <a class="reply-context preview" href="${this.esc(parentHref)}" onclick="event.stopPropagation(); return app.handleThreadLink(event, '${parentId}');">
          <img src="${this.esc(pProfile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-tiny" loading="lazy">
          <span class="snippet">${this.esc(pName)} - ${this.esc(snippet)}</span>
        </a>`;
    } else {
      replyContextHtml = `
        <a class="reply-context preview" id="reply-preview-${ev.id}" href="${this.esc(parentHref)}" onclick="event.stopPropagation(); return app.handleThreadLink(event, '${parentId}');">
          <span class="snippet">返信元を取得中...</span>
        </a>`;
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

  const profileKnown = this.profiles.has(ev.pubkey);
  const visibleClass = '';
  const shouldFetchProfile = !profileKnown;

  const html = `
    <div class="post main-post${visibleClass}" data-event-id="${ev.id}" data-timestamp="${ev.created_at}" onclick="if(!window.getSelection().toString()) { app.openThread('${ev.id}'); }">
      <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">
      <div class="post-content">
        ${replyContextHtml}
        <div class="post-header">
          <div class="header-user-info" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();">
            <span class="user-name pubkey-${ev.pubkey}">${this.esc(dName)}${badgeHtml}</span>
            <span class="user-id nip05-${ev.pubkey}">${this.esc(sName)}</span>
          </div>
          <div class="post-meta">
            ${clientLabelHtml}
            <span class="post-time" title="${new Date(ev.created_at * 1000).toLocaleString()}">· ${timeStr}</span>
          </div>
        </div>
        <div class="post-text">${this.esc(ev.content)}</div>
        <div class="post-actions">
          <a class="action-btn" href="${this.esc(threadHref)}" onclick="event.stopPropagation(); return app.handleThreadLink(event, '${ev.id}');">💬</a>
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

  if (!this._renderingBatch && this.finalizeTimelineVisibility) {
    this.finalizeTimelineVisibility(container);
  }

  if (shouldFetchProfile) {
    this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
  }
};

// 通知の描画
app.renderNotification = function(ev) {
  if (!ev || !this.isValidEventId(ev.id) || !this.isValidEventId(ev.pubkey)) return;

  const container = document.getElementById('timeline-notifications');
  if (!container || container.querySelector(`[data-event-id="${ev.id}"]`)) return;
  if (this.eventStorage) this.eventStorage.set(ev.id, ev);
  const visibleClass = '';
  
  if (ev.kind === 7) {
    const eTag = Array.isArray(ev.tags) ? ev.tags.find(t => Array.isArray(t) && t[0] === 'e') : null;
    const targetId = eTag && this.isValidEventId(eTag[1]) ? eTag[1].toLowerCase() : null;
    const profile = this.profiles.get(ev.pubkey) || {};
    const targetEv = this.eventStorage ? this.eventStorage.get(targetId) : null;
    const snippet = targetEv ? targetEv.content.replace(/\n/g, ' ') : "あなたの投稿";
    
    const dName = profile.display_name || profile.name || "誰か";
    const sName = "@" + (profile.name || ev.pubkey.slice(0, 8) + '...');
    const clientLabelHtml = this.getClientLabelHtml ? this.getClientLabelHtml(ev) : '';
    const timeStr = this.formatTime(ev.created_at);

    const html = `
      <div class="post${visibleClass}" data-event-id="${ev.id}" data-timestamp="${ev.created_at}" onclick="app.openThread('${targetId}')">
        <img src="${this.esc(profile.picture || DEFAULT_CONFIG.defaultIcon)}" class="avatar-sm" onclick="app.openProfile('${ev.pubkey}'); event.stopPropagation();" loading="lazy">
        <div class="post-content">
          <div class="post-header">
            <div class="header-user-info">
              <span class="user-name pubkey-${ev.pubkey}">${this.esc(dName)}</span>
              <span class="user-id nip05-${ev.pubkey}">${this.esc(sName)}</span>
              <span class="notification-action">さんがいいねしました ❤️</span>
            </div>
            <div class="post-meta">
              ${clientLabelHtml}
              <span class="post-time" title="${new Date(ev.created_at * 1000).toLocaleString()}">· ${timeStr}</span>
            </div>
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

    if (!this._renderingBatch && this.finalizeTimelineVisibility) {
      this.finalizeTimelineVisibility(container);
    }

    if (!this.profiles.has(ev.pubkey)) this.fetchProfile(ev.pubkey, () => this.updateUIPost(ev.pubkey));
    if (!targetEv && targetId) this.fetchSingleEvent(targetId);
  } 
  else if (ev.kind === 1) {
    this.renderPost(ev, false, 'timeline-notifications');
  }
};

// UIの事後更新（リプライ先、プロフィール等）
app.updateReplyPreview = function(childId, parentEv) {
  if (!this.isValidEventId(childId) || !parentEv || !this.isValidEventId(parentEv.pubkey)) return;

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
  const containersToFinalize = new Set();

  document.querySelectorAll(`.post`).forEach(el => {
    if (el.innerHTML.includes(`openProfile('${pubkey}')`)) {
      const img = el.querySelector('.avatar-sm');
      const nameEl = el.querySelector(`.pubkey-${pubkey}`);
      const idEl = el.querySelector(`.nip05-${pubkey}`);
      if (img && p.picture) img.src = this.esc(p.picture);
      if (nameEl) nameEl.innerHTML = this.esc(dName) + badgeHtml;
      if (idEl) idEl.innerText = this.esc(sName);

      const container = el.closest('.timeline') || el.parentElement;
      if (container) containersToFinalize.add(container);
    }
  });

  containersToFinalize.forEach(container => {
    if (this.finalizeTimelineVisibility) this.finalizeTimelineVisibility(container);
  });
};
