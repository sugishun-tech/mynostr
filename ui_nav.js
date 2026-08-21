import { app } from './appCore.js';

const DEFAULT_VIEW = 'global';
const BACK_STACK_LIMIT = 20;
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/i;

const VIEW_ALIASES = {
  global: 'global',
  public: 'global',
  home: 'home',
  notification: 'notifications',
  notifications: 'notifications',
  setting: 'settings',
  settings: 'settings',
  thread: 'thread'
};

const VIEW_TO_TAB = {
  global: 'public',
  home: 'home',
  notifications: 'notifications',
  settings: 'setting',
  thread: 'thread'
};

const TAB_TO_VIEW = {
  public: 'global',
  home: 'home',
  notifications: 'notifications',
  setting: 'settings',
  thread: 'thread'
};

app._normalizeRouteView = function(view) {
  const key = String(view || '').trim().toLowerCase();
  return VIEW_ALIASES[key] || DEFAULT_VIEW;
};

app.isValidEventId = function(eventId) {
  return EVENT_ID_PATTERN.test(String(eventId || ''));
};

app._routeToToken = function(route) {
  const view = this._normalizeRouteView(route && route.view);
  if (view === 'thread') {
    const eventId = route && route.eventId;
    return this.isValidEventId(eventId) ? `thread:${eventId.toLowerCase()}` : null;
  }
  return view;
};

app._tokenToRoute = function(token) {
  const value = String(token || '').trim();
  if (!value) return null;

  if (value.startsWith('thread:')) {
    const eventId = value.slice('thread:'.length);
    if (!this.isValidEventId(eventId)) return null;
    return { view: 'thread', eventId: eventId.toLowerCase() };
  }

  const key = value.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(VIEW_ALIASES, key)) return null;
  const view = VIEW_ALIASES[key];
  if (view === 'thread') return null;
  return { view, eventId: null };
};

app._parseBackStack = function(value) {
  return String(value || '')
    .slice(0, 4096)
    .split('|')
    .slice(0, BACK_STACK_LIMIT)
    .map(token => this._tokenToRoute(token))
    .filter(Boolean)
    .map(route => this._routeToToken(route));
};

app.parseRouteSearch = function(search = window.location.search) {
  const rawSearch = String(search || '').replace(/^\?/, '');
  const params = new URLSearchParams(rawSearch);
  const rawView = params.get('view') || params.get('page') || params.get('tab') || DEFAULT_VIEW;
  let view = this._normalizeRouteView(rawView);
  let eventId = params.get('id') || params.get('event') || params.get('eventId') || null;

  if (view === 'thread') {
    if (!this.isValidEventId(eventId)) {
      view = DEFAULT_VIEW;
      eventId = null;
    } else {
      eventId = eventId.toLowerCase();
    }
  } else {
    eventId = null;
  }

  return {
    view,
    tab: VIEW_TO_TAB[view],
    eventId,
    backStack: view === 'thread' ? this._parseBackStack(params.get('back')) : []
  };
};

app.getRoute = function() {
  return this.parseRouteSearch(window.location.search);
};

app.getCurrentTab = function() {
  return this.getRoute().tab;
};

app.getCurrentThreadId = function() {
  const route = this.getRoute();
  return route.view === 'thread' ? route.eventId : null;
};

app.buildRouteUrl = function(route) {
  const view = this._normalizeRouteView(route && route.view);
  const normalizedRoute = {
    view,
    eventId: route && route.eventId,
    backStack: Array.isArray(route && route.backStack) ? route.backStack : []
  };

  if (normalizedRoute.view === 'thread' && !this.isValidEventId(normalizedRoute.eventId)) {
    normalizedRoute.view = DEFAULT_VIEW;
    normalizedRoute.eventId = null;
  }

  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  params.set('view', normalizedRoute.view);

  if (normalizedRoute.view === 'thread') {
    params.set('id', String(normalizedRoute.eventId).toLowerCase());
  }

  const backStack = normalizedRoute.backStack
    .slice(0, BACK_STACK_LIMIT)
    .map(token => this._tokenToRoute(token))
    .filter(Boolean)
    .map(parsedRoute => this._routeToToken(parsedRoute));

  if (normalizedRoute.view === 'thread' && backStack.length > 0) {
    params.set('back', backStack.join('|'));
  }

  url.search = params.toString();
  url.hash = '';
  return url;
};

app.navigateToRoute = function(route, { replace = false } = {}) {
  const url = this.buildRouteUrl(route);
  const current = `${window.location.pathname}${window.location.search}`;
  const destination = `${url.pathname}${url.search}`;

  if (current !== destination) {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', destination);
  }

  return this.applyRouteFromQuery();
};

app.handleRouteLink = function(event, view) {
  if (event && (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )) {
    return true;
  }

  if (event) event.preventDefault();
  this.navigateToRoute({ view, backStack: [] });
  return false;
};

app.switchTab = function(tab) {
  const view = TAB_TO_VIEW[tab] || this._normalizeRouteView(tab);
  return this.navigateToRoute({ view, backStack: [] });
};

app.getThreadPermalink = function(eventId) {
  if (!this.isValidEventId(eventId)) return '#';
  const url = this.buildRouteUrl({
    view: 'thread',
    eventId: String(eventId).toLowerCase(),
    backStack: []
  });
  return `${url.pathname}${url.search}`;
};

app.handleThreadLink = function(event, eventId) {
  if (window.getSelection && window.getSelection().toString()) {
    if (event) event.preventDefault();
    return false;
  }

  if (event && (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )) {
    return true;
  }

  if (event) event.preventDefault();
  this.openThread(eventId);
  return false;
};

app.openProfile = function(pubkey) {
  if (!this.isValidEventId(pubkey)) return;

  const url = new URL('https://sugishun-tech.github.io/mynostr_profile/');
  url.searchParams.set('hex', String(pubkey).toLowerCase());
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
};

app.openThread = function(eventId) {
  if (!this.isValidEventId(eventId)) return;

  const normalizedEventId = String(eventId).toLowerCase();
  const currentRoute = this.getRoute();
  if (currentRoute.view === 'thread' && currentRoute.eventId === normalizedEventId) return;

  const currentToken = this._routeToToken(currentRoute);
  const backStack = [currentToken, ...currentRoute.backStack]
    .filter(Boolean)
    .filter((token, index, items) => index === 0 || token !== items[index - 1])
    .slice(0, BACK_STACK_LIMIT);

  return this.navigateToRoute({
    view: 'thread',
    eventId: normalizedEventId,
    backStack
  });
};

app.getBackDestination = function(route = this.getRoute()) {
  const stack = Array.isArray(route.backStack) ? [...route.backStack] : [];
  const token = stack.shift();
  const destination = this._tokenToRoute(token) || { view: DEFAULT_VIEW, eventId: null };
  destination.backStack = stack;
  return destination;
};

app.handleBackLink = function(event) {
  if (event && (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )) {
    return true;
  }

  if (event) event.preventDefault();
  this.navigateToRoute(this.getBackDestination());
  return false;
};

app.goBack = function() {
  return this.navigateToRoute(this.getBackDestination());
};

app._updateBackLink = function(route) {
  const link = document.getElementById('thread-back-link');
  if (!link) return;

  const destination = this.getBackDestination(route);
  const url = this.buildRouteUrl(destination);
  link.href = `${url.pathname}${url.search}`;

  const labels = {
    global: 'グローバル',
    home: 'ホーム',
    notifications: '通知',
    settings: '設定',
    thread: 'スレッド'
  };
  link.title = `${labels[destination.view] || 'グローバル'}へ戻る`;
};

app.loadThread = async function(eventId) {
  if (!this.isValidEventId(eventId)) return;

  const normalizedEventId = String(eventId).toLowerCase();
  const containers = {
    parent: document.getElementById('thread-parent-post'),
    main: document.getElementById('thread-main-post'),
    replies: document.getElementById('timeline-thread')
  };

  Object.values(containers).forEach(el => {
    if (!el) return;
    el.innerHTML = '';
    el.classList.remove('hidden');
    el.style.display = '';
  });

  const ev = await this.getSingleEvent([{ ids: [normalizedEventId] }]);
  const currentRoute = this.getRoute();
  if (currentRoute.view !== 'thread' || currentRoute.eventId !== normalizedEventId) return;

  if (!ev) {
    if (containers.main) {
      containers.main.innerHTML = '<div class="empty-state">投稿を取得できませんでした。</div>';
    }
    return;
  }

  if (this.eventStorage) this.eventStorage.set(ev.id, ev);
  if (this.prefetchProfiles) await this.prefetchProfiles([ev]);

  const routeAfterProfile = this.getRoute();
  if (routeAfterProfile.view !== 'thread' || routeAfterProfile.eventId !== normalizedEventId) return;
  this.renderPost(ev, false, 'thread-main-post');

  const fetchParent = async () => {
    const eTags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t) && t[0] === 'e') : [];
    if (eTags.length === 0) return;

    const parentTag = eTags.find(t => t[3] === 'reply') || eTags[eTags.length - 1];
    if (!parentTag || !this.isValidEventId(parentTag[1])) return;

    const parentEvent = await this.getSingleEvent([{ ids: [parentTag[1]] }]);
    const route = this.getRoute();
    if (route.view !== 'thread' || route.eventId !== normalizedEventId || !parentEvent) return;

    if (this.eventStorage) this.eventStorage.set(parentEvent.id, parentEvent);
    if (this.prefetchProfiles) await this.prefetchProfiles([parentEvent]);

    const routeAfterParentProfile = this.getRoute();
    if (routeAfterParentProfile.view !== 'thread' || routeAfterParentProfile.eventId !== normalizedEventId) return;
    this.renderPost(parentEvent, false, 'thread-parent-post');
  };

  const fetchReplies = async () => {
    const childEvents = await this.query([{ kinds: [1], '#e': [ev.id] }]);
    const route = this.getRoute();
    if (route.view !== 'thread' || route.eventId !== normalizedEventId) return;

    const directReplies = (childEvents || []).filter(childEv => (
      Array.isArray(childEv.tags) &&
      childEv.tags.some(t => Array.isArray(t) && t[0] === 'e' && t[1] === ev.id)
    ));

    if (directReplies.length > 0 && containers.replies) {
      containers.replies.classList.remove('hidden');
    }

    if (this.renderSortedEvents) {
      await this.renderSortedEvents(directReplies, 'timeline-thread');
    }
  };

  await Promise.allSettled([fetchParent(), fetchReplies()]);
};

app.applyRouteFromQuery = async function() {
  const route = this.getRoute();

  document
    .querySelectorAll('.timeline, #page-setting, #post-area, #page-profile, #page-thread, #page-mutelist')
    .forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));

  const navEl = document.getElementById(`nav-${route.tab}`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    public: 'グローバル',
    home: 'ホーム',
    notifications: '通知',
    setting: '設定',
    thread: 'スレッド'
  };
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.innerText = titles[route.tab] || '';

  const feedControls = document.getElementById('feed-controls');
  if (feedControls) {
    feedControls.classList.toggle('hidden', route.tab === 'setting' || route.tab === 'thread');
  }

  if (route.tab === 'setting') {
    const page = document.getElementById('page-setting');
    if (page) page.classList.remove('hidden');
    return route;
  }

  if (route.tab === 'thread') {
    const page = document.getElementById('page-thread');
    if (page) page.classList.remove('hidden');
    this._updateBackLink(route);
    await this.loadThread(route.eventId);
    return route;
  }

  const timeline = document.getElementById(`timeline-${route.tab}`);
  if (timeline) timeline.classList.remove('hidden');

  if (route.tab === 'home' || route.tab === 'public') {
    const postArea = document.getElementById('post-area');
    if (postArea) postArea.classList.remove('hidden');
  }

  if (timeline && timeline.children.length === 0 && this.fetchFeed) {
    await this.fetchFeed('older');
  }

  return route;
};

app.initRouting = async function() {
  if (!this._routingInitialized) {
    window.addEventListener('popstate', () => {
      this.applyRouteFromQuery().catch(e => console.error('画面遷移に失敗しました', e));
    });
    this._routingInitialized = true;
  }

  const route = this.getRoute();
  const canonicalUrl = this.buildRouteUrl(route);
  const canonicalPath = `${canonicalUrl.pathname}${canonicalUrl.search}`;
  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (canonicalPath !== currentPath) {
    window.history.replaceState(null, '', canonicalPath);
  }

  return this.applyRouteFromQuery();
};
