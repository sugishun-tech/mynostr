import { app } from './appCore.js';

app.fetchFeed = function(direction) {
  const tab = this.activeTab;
  const state = this.state[tab];
  const now = Math.floor(Date.now() / 1000);
  
  // -----------------------------------------
  // 1. タブごとのベースフィルタ構築
  // -----------------------------------------
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

  // -----------------------------------------
  // 2. 取得方向(direction)に基づく時間軸の設定
  // -----------------------------------------
  if (direction === 'latest') {
    // 現在時刻から過去へバッチサイズ分
    filter.until = now;
  } 
  else if (direction === 'newer') {
    // 現在表示されている最新の投稿(state.newest)から現在時刻までの間で、最新から過去へバッチサイズ分
    filter.since = state.newest;
    filter.until = now;
  } 
  else if (direction === 'older') {
    // 現在表示されている最古の投稿(state.oldest)から過去へバッチサイズ分
    filter.until = state.oldest;
  }

  // -----------------------------------------
  // 3. データ取得と状態の更新
  // -----------------------------------------
  const containerId = tab === 'notifications' ? 'timeline-notifications' : `timeline-${tab}`;
  const container = document.getElementById(containerId);

  this.query([filter], (event) => {
    // 【重要】他タブの状況は無視し、このタブのDOMに存在するかだけで重複判定
    if (container && container.querySelector(`[data-event-id="${event.id}"]`)) return;

    // 全体キャッシュには一応入れておく（他機能での参照用）
    if(this.eventStorage) this.eventStorage.set(event.id, event);
    
    // 状態(state)の更新：初回の0を考慮しつつ、最新・最古を更新
    if (event.created_at > state.newest) state.newest = event.created_at;
    if (event.created_at < state.oldest || state.oldest === 0) state.oldest = event.created_at;

    // UIへ描画（挿入位置の計算はUI側に任せる）
    if (tab === 'notifications') {
      this.renderNotification(event);
    } else {
      this.renderPost(event, false, containerId);
    }
  });
};

app.fetchSingleEvent = function(id) {
  this.query([{ ids: [id] }], (ev) => {
    if(this.eventStorage) this.eventStorage.set(ev.id, ev);
    const els = document.querySelectorAll('.snippet');
    els.forEach(el => {
      if(el.innerText.includes("取得中...")) {
        el.innerText = `Replying to: ${ev.content.replace(/\n/g, ' ')}`;
      }
    });
  });
};
