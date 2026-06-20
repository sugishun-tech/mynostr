import { app } from './appCore.js';
// 文字列のエスケープ処理
app.esc = function(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};

// HTML文字列をDOM要素に変換
app.createHTMLElement = function(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstChild;
};

// バッチサイズの表示更新
app.updateBatchDisplay = function() {
  document.querySelectorAll('.batch-num').forEach(el => el.innerText = this.batchSize);
};

// Unixタイムスタンプを日時にフォーマット
app.formatTime = function(unix) {
  const date = new Date(unix * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

app._splitLines = function(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
};

app._safeRegexList = function(patterns) {
  return (patterns || []).map(pattern => {
    try {
      return new RegExp(pattern, 'i');
    } catch (e) {
      console.warn('Invalid mute regex ignored:', pattern, e);
      return null;
    }
  }).filter(Boolean);
};

app.hasDisplayNameMuteRules = function() {
  return this._safeRegexList(this.muteDisplayNamePatterns).length > 0;
};

app.hasUsableDisplayName = function(profile) {
  return !!(
    profile &&
    typeof profile.display_name === 'string' &&
    profile.display_name.trim().length > 0
  );
};

app.hasUsableName = function(profile) {
  return !!(
    profile &&
    typeof profile.name === 'string' &&
    profile.name.trim().length > 0
  );
};


app.prefetchProfiles = async function(events) {
  if (!Array.isArray(events) || !this.fetchProfile) return;

  const pubkeys = Array.from(new Set(
    events
      .map(ev => ev && ev.pubkey)
      .filter(pubkey => pubkey && !this.profiles.has(pubkey))
  ));

  if (pubkeys.length === 0) return;

  await Promise.all(pubkeys.map(pubkey => {
    return this.fetchProfile(pubkey).catch(e => {
      console.warn('プロフィール取得エラー', pubkey, e);
      if (!this.profiles.has(pubkey)) this.profiles.set(pubkey, {});
      return null;
    });
  }));
};

app.isMutedEvent = function(ev) {
  if (!ev) return false;
  if (this.mutedPubkeys && this.mutedPubkeys.has(String(ev.pubkey || '').toLowerCase())) return true;

  const profile = this.profiles.get(ev.pubkey) || {};
  const displayName = this.hasUsableDisplayName(profile) ? profile.display_name.trim() : '';
  const pname = this.hasUsableName(profile) ? profile.name.trim() : ''; 
  const content = ev.content || '';

  if (this._safeRegexList(this.muteContentPatterns).some(re => re.test(content))) return true;
  if (this._safeRegexList(this.muteDisplayNamePatterns).some(re => re.test(displayName))) return true;
  if (this._safeRegexList(this.muteDisplayNamePatterns).some(re => re.test(pname))) return true;  
  return false;
};

// 表示してから消すのではなく、表示してよいと確定した投稿だけ .visible を付ける。
// 通知以外の投稿は display_name が取得できない限り非表示のまま保持する。
// そのうえで、プロフィール取得と時系列ソートが終わった後にだけ表示判定する。
app.canRevealEvent = function(ev, elementOrContainer = null) {
  if (!ev) return false;

  const inNotifications = elementOrContainer && (
    (elementOrContainer.id === 'timeline-notifications') ||
    (elementOrContainer.closest && elementOrContainer.closest('#timeline-notifications'))
  );
  if (inNotifications) return true;

  if (this.mutedPubkeys && this.mutedPubkeys.has(String(ev.pubkey || '').toLowerCase())) return false;
  if (this._safeRegexList(this.muteContentPatterns).some(re => re.test(ev.content || ''))) return false;

  const profile = this.profiles.get(ev.pubkey);
  if (!this.hasUsableDisplayName(profile) || !this.hasUsableName(profile)) return false;
  const displayNameRules = this._safeRegexList(this.muteDisplayNamePatterns);
  const displayName = profile.display_name.trim();
  const pname = profile.name.trim()  
  if (displayNameRules.some(re => re.test(displayName))) return false;
  if (displayNameRules.some(re => re.test(pname))) return false;
  return true;
};

app.applyMuteVisibility = function(target = document) {
  target.querySelectorAll('.post').forEach(el => {
    const id = el.getAttribute('data-event-id');
    const ev = this.eventStorage ? this.eventStorage.get(id) : null;
    if (!ev) return;
    el.classList.toggle('visible', this.canRevealEvent(ev, el));
  });
};

// 表示確定は必ずこの関数に集約する。
// 1. いったん visible を全部外す
// 2. DOM順を timestamp/id で確定する
// 3. ミュート判定を通過したものだけ visible を付ける
// これで「表示してからソート」という人類おなじみのチラつき事故を防ぐ。
app.finalizeTimelineVisibility = function(container) {
  if (!container) return;
  container.querySelectorAll('.post.visible').forEach(el => el.classList.remove('visible'));
  this.sortTimelineContainer(container);
  this.applyMuteVisibility(container);
};

app.sortTimelineContainer = function(container) {
  if (!container) return;
  const posts = Array.from(container.children).filter(el => el.classList && el.classList.contains('post'));
  posts.sort((a, b) => {
    const at = parseInt(a.getAttribute('data-timestamp') || '0', 10);
    const bt = parseInt(b.getAttribute('data-timestamp') || '0', 10);
    if (bt !== at) return bt - at;
    return String(b.getAttribute('data-event-id') || '').localeCompare(String(a.getAttribute('data-event-id') || ''));
  });
  const frag = document.createDocumentFragment();
  posts.forEach(el => frag.appendChild(el));
  container.appendChild(frag);
};

app.renderSortedEvents = async function(events, containerId) {
  const container = document.getElementById(containerId);
  if (!container || !Array.isArray(events) || events.length === 0) return;

  const sorted = [...events].sort((a, b) => {
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return String(b.id).localeCompare(String(a.id));
  });

  if (containerId !== 'timeline-notifications') {
    await this.prefetchProfiles(sorted);
  }

  const previousRenderingBatch = this._renderingBatch;
  this._renderingBatch = true;
  try {
    sorted.forEach(ev => {
      if (containerId === 'timeline-notifications') this.renderNotification(ev);
      else this.renderPost(ev, false, containerId);
    });
  } finally {
    this._renderingBatch = previousRenderingBatch;
  }

  this.finalizeTimelineVisibility(container);
};
