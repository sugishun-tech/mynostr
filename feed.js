import { app } from './appCore.js';

app.fetchFeed = async function(direction) {
  const tab = this.activeTab;
  const state = this.state[tab];
  const now = Math.floor(Date.now() / 1000);
  
  let filter = { kinds: [1], limit: this.batchSize };

  switch (tab) {
    case 'home':
      if (!this.myPubkey) return alert("ログインが必要です");
      filter.authors = [this.myPubkey, ...Array.from(this.following)];
      if (filter.authors.length === 0) return;
      break;
    case 'profile':
      if (!this.currentProfilePubkey) return;
      filter.authors = [this.currentProfilePubkey];
      break;
    case 'notifications':
      if (!this.myPubkey) return alert("ログインが必要です");
      filter = { "#p": [this.myPubkey], kinds: [1, 7], limit: this.batchSize };
      break;
    case 'thread':
      filter = { "#e": [this.currentThreadId], kinds: [1], limit: this.batchSize };
      break;
  }

  if (direction === 'latest') {
    filter.until = now;
  } else if (direction === 'newer') {
    filter.since = state.newest;
  } else if (direction === 'older') {
    filter.until = state.oldest;
  }

  const containerId = tab === 'notifications' ? 'timeline-notifications' : `timeline-${tab}`;
  const container = document.getElementById(containerId);

  const fetchedEvents = await this.query([filter], (event) => {
    if (container && container.querySelector(`[data-event-id="${event.id}"]`)) return;
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
    state.oldest -= 3600; // 取得が空振った場合は1時間遡る
  } else if (direction === 'newer') {
    state.newest += 3600;
  }
};

app.fetchSingleEvent = function(id) {
  this.getSingleEvent([{ ids: [id] }]).then(ev => {
    if(!ev) return;
    if(this.eventStorage) this.eventStorage.set(ev.id, ev);
    const els = document.querySelectorAll('.snippet');
    els.forEach(el => {
      if(el.innerText.includes("取得中...")) {
        el.innerText = `Replying to: ${ev.content.replace(/\n/g, ' ')}`;
      }
    });
  });
};
