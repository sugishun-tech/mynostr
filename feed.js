import { app } from './appCore.js';

app.fetchFeed = async function(direction) {
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
  // 2. 取得方向に基づく時間軸の設定
  // -----------------------------------------
  if (direction === 'latest') {
    filter.until = now;
  } else if (direction === 'newer') {
    filter.since = state.newest;
    filter.until = now;
  } else if (direction === 'older') {
    filter.until = state.oldest;
  }

  // -----------------------------------------
  // 3. データ取得と状態の更新 (飛び飛び問題の解消)
  // -----------------------------------------
  const containerId = tab === 'notifications' ? 'timeline-notifications' : `timeline-${tab}`;
  const container = document.getElementById(containerId);

  // 【修正のコア】
  // イベント受信ごとのコールバックで描画は即座に行いUXを保つが、
  // `state.oldest` の更新は通信が完了してから安全に計算する。
  const fetchedEvents = await this.query([filter], (event) => {
    // 重複チェックと描画はリアルタイムに行う
    if (container && container.querySelector(`[data-event-id="${event.id}"]`)) return;
    if(this.eventStorage) this.eventStorage.set(event.id, event);

    // 新しい方の時間はリアルタイム更新でOK
    if (event.created_at > state.newest) state.newest = event.created_at;

    // ※ここでは古い方の時間（state.oldest）を更新しない！

    if (tab === 'notifications') {
      this.renderNotification(event);
    } else {
      this.renderPost(event, false, containerId);
    }
  });

  // 通信完了後、全リレーのデータを統合して「抜け」がない基点を計算する
  if (fetchedEvents && fetchedEvents.length > 0) {
    // 重複を排除して新しい順(降順)に並べる
    const uniqueEvents = Array.from(new Map(fetchedEvents.map(e => [e.id, e])).values());
    uniqueEvents.sort((a, b) => b.created_at - a.created_at);

    // 要求したバッチサイズ（例:20）番目のイベント時間を「次回の取得基点」にする
    // ※過疎リレーが返してきた「古すぎる時間」にoldestが引っ張られるのを防ぐ
    const limitIndex = Math.min(this.batchSize, uniqueEvents.length) - 1;
    const safeOldest = uniqueEvents[limitIndex].created_at;

    if (state.oldest === 0 || direction === 'older' || (direction === 'latest' && safeOldest < state.oldest)) {
        state.oldest = safeOldest;
    }
  }
};

// 既存の取得メソッドも、前回作った getSingleEvent を使うと綺麗になります
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
