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
