// network.js
import { app } from './appCore.js';

app._eventQueue = app._eventQueue || new Set();
app._eventCallbacks = app._eventCallbacks || [];
app._eventTimer = app._eventTimer || null;

app.connectRelays = function() {};

// network.js
app.broadcast = async function(signedEvent) {
  console.log("Broadcasting to:", this.relayUrls);

  if (!this.relayUrls || this.relayUrls.length === 0) {
    console.error("No relays configured.");
    return;
  }

  // nostr-tools v2系以降の仕様:
  // pool.publish は各リレーの Promise 配列を返すのではなく、
  // 内部で複数のリレーへ送信を開始します。
  try {
    // 確実に送信を試みるための Promise.any
    // pool.publish() の結果を await することで、
    // 少なくとも一つのリレーに到達した時点で成功とみなします。
    await Promise.any(this.pool.publish(this.relayUrls, signedEvent));
    
    console.log("[SUCCESS] Event published successfully to at least one relay.");
  } catch (e) {
    // すべてのリレーで失敗した場合は AggregateError が発生します
    console.error("[FAILED] Could not publish to any relay:", e);
    throw e; 
  }
};

app.broadcast_old = async function(signedEvent) {
  if (!this.relayUrls || this.relayUrls.length === 0) {
    console.error("Relay URLs are empty.");
    throw new Error("リレーが設定されていません");
  }

  console.log("Broadcasting event:", signedEvent);

  // 全リレーに対して一斉送信
  const pubs = this.pool.publish(this.relayUrls, signedEvent);
  
  // 成功を確認するための Promise 配列
  const promises = pubs.map(pub => {
    return new Promise((resolve, reject) => {
      // タイムアウト設定（5秒反応がなければ失敗とみなす）
      const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
      
      pub.on('ok', () => {
        clearTimeout(timeout);
        resolve();
      });
      pub.on('failed', (reason) => {
        clearTimeout(timeout);
        reject(new Error(reason));
      });
    });
  });

  try {
    // 少なくとも一つのリレーが受け取れば成功とする
    await Promise.any(promises);
    console.log("Broadcast successful at least one relay");
  } catch (e) {
    console.error("Broadcast failed on all relays:", e);
    // ユーザーに通知するために例外を投げる
    throw e;
  }
};

/**
 * タイムライン取得
 * fetchLatestEvents が until を無視するリレー対策として
 * fetchAllEvents を使い、自前で limit 制御を行います。
 */
// network.js
app.query = async function(filters, onEvent) {
  const rawFilter = filters[0];
  const fetchLimit = rawFilter.limit || 30;

  console.log(`[DEBUG] query START: until=${rawFilter.until || 'now'}, limit=${fetchLimit}`);

  try {
    return new Promise((resolve) => {
      const events = [];
      
      // nostr-tools v1.17.0 の仕様に合わせて .sub() を使用します
      const sub = this.pool.sub(this.relayUrls, [rawFilter]);

      // イベント受信時の処理
      sub.on('event', (ev) => {
        // until や since を無視する一部のポンコツリレー対策
        if (rawFilter.until && ev.created_at > rawFilter.until) return;
        if (rawFilter.since && ev.created_at < rawFilter.since) return;

        // 重複チェックをしてから配列に追加
        if (!events.some(e => e.id === ev.id)) {
          events.push(ev);
        }
      });

      let isFinished = false;
      const finish = () => {
        if (isFinished) return;
        isFinished = true;
        // v1系では .close() ではなく .unsub() で通信を閉じます
        sub.unsub(); 
        
        // 時間の新しい順にソートして、きっちり fetchLimit 件（30件など）だけ抽出
        events.sort((a, b) => b.created_at - a.created_at);
        const finalEvents = events.slice(0, fetchLimit);
        
        // ソート済みの綺麗な状態からUIへ一気に描画
        finalEvents.forEach(ev => {
          if (onEvent) onEvent(ev);
        });
        
        console.log(`[DEBUG] query END: fetched ${finalEvents.length} events.`);
        resolve(finalEvents); // feed.js の state 更新用に配列を返す
      };

      // リレーから「これ以上データはないよ(End of Stored Events)」の合図が来たら終了処理へ
      sub.on('eose', () => {
        finish();
      });

      // 3秒経過したら強制終了（反応の遅いリレーを無限に待ってタイムラインが止まるのを防ぐ）
      setTimeout(finish, 3000);
    });
  } catch (e) {
    console.error("[DEBUG] query FATAL:", e);
    return [];
  }
};

app.getSingleEvent = async function(filters) {
  try {
    const { since, until, limit, ...cleanFilter } = filters[0];
    const ev = await app.fetcher.fetchLastEvent(this.relayUrls, cleanFilter);
    return ev || null;
  } catch (e) {
    return null;
  }
};

app.fetchEventBatched = function(id, cb) {
  if (this.eventStorage && this.eventStorage.has(id)) {
    if (cb) cb(this.eventStorage.get(id));
    return;
  }
  this._eventQueue.add(id);
  this._eventCallbacks.push({ id, cb });
  if (!this._eventTimer) {
    this._eventTimer = setTimeout(async () => {
      const ids = Array.from(this._eventQueue);
      const callbacks = [...this._eventCallbacks];
      this._eventQueue.clear();
      this._eventCallbacks = [];
      this._eventTimer = null;
      try {
        const evs = await app.fetcher.fetchAllEvents(this.relayUrls, { ids }, {});
        evs.forEach(ev => {
          if(this.eventStorage) this.eventStorage.set(ev.id, ev);
        });
        callbacks.forEach(({ id, cb }) => {
          if (cb) cb(this.eventStorage.get(id) || null);
        });
      } catch(e) {}
    }, 200);
  }
};
