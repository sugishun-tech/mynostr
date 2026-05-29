import { app } from './appCore.js';

app._chunkArray = function(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

app._buildFeedFilters = function(tab, direction, state) {
  const now = Math.floor(Date.now() / 1000);
  const base = { kinds: [1] };
  let filters = [];

  switch (tab) {
    case 'home': {
      if (!this.myPubkey) {
        alert("ログインが必要です");
        return [];
      }
      const authors = Array.from(new Set([this.myPubkey, ...Array.from(this.following)])).filter(Boolean);
      if (authors.length === 0) return [];
      filters = this._chunkArray(authors, 50).map(chunk => ({ ...base, authors: chunk }));
      break;
    }
    case 'profile':
      if (!this.currentProfilePubkey) return [];
      filters = [{ ...base, authors: [this.currentProfilePubkey] }];
      break;
    case 'notifications':
      if (!this.myPubkey) {
        alert("ログインが必要です");
        return [];
      }
      filters = [{ "#p": [this.myPubkey], kinds: [1, 7] }];
      break;
    case 'thread':
      filters = [{ "#e": [this.currentThreadId], kinds: [1] }];
      break;
    default:
      filters = [base];
      break;
  }

  return filters.map(filter => {
    const f = { ...filter };
    if (direction === 'latest') {
      f.limit = this.batchSize;
      delete f.since;
      delete f.until;
    } else if (direction === 'newer') {
      f.since = state.newest;
      f.until = Math.min(state.newest + 600, now);
      delete f.limit;
    } else if (direction === 'older') {
      f.until = state.oldest;
      f.limit = this.batchSize;
    } else {
      f.limit = this.batchSize;
    }
    return f;
  });
};

app.fetchFeed = async function(direction) {
  const tab = this.activeTab;
  const state = this.state[tab];
  const filters = this._buildFeedFilters(tab, direction, state);
  if (filters.length === 0) return;

  const containerId = tab === 'notifications' ? 'timeline-notifications' : `timeline-${tab}`;
  const container = document.getElementById(containerId);

  const fetchedEvents = await this.query(filters, (event) => {
    if (container && container.querySelector(`.main-post[data-event-id="${event.id}"]`)) return;
    if (this.eventStorage) this.eventStorage.set(event.id, event);

    if (event.created_at > state.newest) state.newest = event.created_at;

    if (tab === 'notifications') {
      this.renderNotification(event);
    } else {
      this.renderPost(event, false, containerId);
    }
  });

  if (fetchedEvents && fetchedEvents.length > 0) {
    const sorted = fetchedEvents.sort((a, b) => b.created_at - a.created_at);
    const oldestInBatch = sorted[sorted.length - 1].created_at;
    if (direction === 'older' || state.oldest === 0) {
      state.oldest = oldestInBatch - 1;
    } else if (direction === 'latest' && oldestInBatch < state.oldest) {
      state.oldest = oldestInBatch - 1;
    }
  } else if (direction === 'older') {
    state.oldest -= 3600;
  }
};

app.fetchSingleEvent = function(id) {
  this.fetchEventBatched(id, (ev) => {
    if(!ev) return;
    const els = document.querySelectorAll('.snippet');
    els.forEach(el => {
      if(el.innerText.includes("取得中...")) {
        el.innerText = `Replying to: ${ev.content.replace(/\n/g, ' ')}`;
      }
    });
  });
};
