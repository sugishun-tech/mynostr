import { app } from './appCore.js';

app.connectRelays = function() {
  // SimplePool が必要に応じて自動的に接続・再接続を管理するため、
  // 明示的な WebSocket の生成と初期化は不要になりました。
};

app.broadcast = function(signedEvent) {
  try {
    // 全リレーに対してイベントをパブリッシュします
    this.pool.publish(this.relayUrls, signedEvent);
  } catch(e) {
    console.error("Broadcast failed:", e);
  }
};

app.query = function(filters, onEvent) {
  return new Promise((resolve) => {
    const collectedEvents = [];
    
    // subscribeMany を使い、指定した全リレーから安全にデータを収集します
    const sub = this.pool.subscribeMany(
      this.relayUrls,
      filters,
      {
        onevent: (ev) => {
          collectedEvents.push(ev);
          if (onEvent) onEvent(ev); // 逐次描画の維持
        },
        oneose: () => {
          // すべてのリレーからデータを取り切り、終了通知が来たら閉じる
          sub.close();
          resolve(collectedEvents);
        }
      }
    );

    // EOSEを返さない不良リレーが存在する場合のフェイルセーフ (5秒)
    setTimeout(() => {
      sub.close();
      resolve(collectedEvents);
    }, 3000);
  });
};

app.getSingleEvent = function(filters) {
  return new Promise((resolve) => {
    let handled = false;

    const sub = this.pool.subscribeMany(
      this.relayUrls,
      filters,
      {
        onevent: (ev) => {
          if (!handled) {
            handled = true;
            sub.close(); // 1件見つけた瞬間に即座に切断して爆速化
            resolve(ev);
          }
        },
        oneose: () => {
          if (!handled) {
            handled = true;
            sub.close();
            resolve(null);
          }
        }
      }
    );

    // タイムアウト時のフェイルセーフ
    setTimeout(() => {
      if (!handled) {
        handled = true;
        sub.close();
        resolve(null);
      }
    }, 2500);
  });
};

// network.js の末尾に追記
app._eventQueue = new Set();
app._eventCallbacks = [];
app._eventTimer = null;

app.fetchEventBatched = function(id, cb) {
  if (this.eventStorage && this.eventStorage.has(id)) {
    if (cb) cb(this.eventStorage.get(id));
    return;
  }
  
  this._eventQueue.add(id);
  this._eventCallbacks.push({ id, cb });

  if (!this._eventTimer) {
    // 100ms待機して、溜まったリクエストを1回のREQでまとめて取得
    this._eventTimer = setTimeout(async () => {
      const ids = Array.from(this._eventQueue);
      const callbacks = [...this._eventCallbacks];
      
      this._eventQueue.clear();
      this._eventCallbacks = [];
      this._eventTimer = null;

      if (ids.length === 0) return;

      // まとめて取得
      const evs = await this.query([{ ids: ids }]);
      evs.forEach(ev => {
        if (this.eventStorage) this.eventStorage.set(ev.id, ev);
      });

      // 各コールバックに結果を返す
      callbacks.forEach(({ id, cb }) => {
        if (cb) cb(this.eventStorage ? this.eventStorage.get(id) : null);
      });
    }, 100);
  }
};
