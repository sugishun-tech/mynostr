import { app } from './appCore.js';

app.fetchFeed = function(direction) {
  const tab = this.activeTab;
  const state = this.state[tab];
  let filter = { kinds: [1] };

  if (tab === 'home') {
    if (!this.myPubkey) return alert("ログインが必要です");
    filter.authors = [this.myPubkey, ...Array.from(this.following)];
    if (filter.authors.length === 0) return;
  } else if (tab === 'profile') {
    if (!this.currentProfilePubkey) return;
    filter.authors = [this.currentProfilePubkey];
  } else if (tab === 'notifications') {
    if (!this.myPubkey) return alert("ログインが必要です");
    filter = { "#p": [this.myPubkey], kinds: [1, 7] };
  } else if (tab === 'thread') {
    filter = { "#e": [this.currentThreadId], kinds: [1] };
  }

  if (direction === 'latest') {
    filter.since = state.newest + 1;
    filter.until = Math.floor(Date.now() / 1000);
  } else if (direction === 'newer') {
    filter.since = state.newest + 1;
    filter.limit = this.batchSize;
  } else if (direction === 'older') {
    filter.until = state.oldest - 1;
    filter.limit = this.batchSize;
  }

  this.query([filter], (event) => {
    //if (this.eventStorage.has(event.id) && direction !== 'latest' && direction !== 'newer') return; 
    this.eventStorage.set(event.id, event);
    
    state.newest = Math.max(state.newest, event.created_at);
    state.oldest = Math.min(state.oldest, event.created_at);

    if (tab === 'notifications') {
      this.renderNotification(event, direction !== 'older');
    } else {
      this.renderPost(event, direction !== 'older');
    }
  });
};

app.fetchSingleEvent = function(id) {
  this.query([{ ids: [id] }], (ev) => {
    this.eventStorage.set(ev.id, ev);
    const els = document.querySelectorAll('.snippet');
    els.forEach(el => {
      if(el.innerText.includes("取得中...")) el.innerText = `Replying to: ${ev.content.replace(/\n/g, ' ')}`;
    });
  });
};
