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
app.query = async function(filters, onEvent) {
  const rawFilter = filters[0];
  const { since, until, limit, ...cleanFilter } = rawFilter;
  const fetchLimit = limit || 30;

  console.log(`[DEBUG] query START: until=${until || 'now'}, limit=${fetchLimit}`);

  try {
    // 時間範囲を定義
    const timeRange = {};
    if (until) timeRange.until = until;
    if (since) timeRange.since = since;

    // fetchAllEvents はジェネレータのように動作するため、
    // fetchLimit に達した時点で自前で打ち切ることで「下30件」を確実に実現します。
    const events = [];
    
    // allEventsIterator を使用して、1件ずつ取得を制御
    const iter = app.fetcher.allEventsIterator(
      this.relayUrls,
      cleanFilter,
      timeRange,
      { sort: true } // 常に新しい順にソートして取得
    );

    for await (const ev of iter) {
      events.push(ev);
      if (onEvent) onEvent(ev);
      
      // 指定件数（30件）に達したら即座にストップして、リレーとの通信を切る
      if (events.length >= fetchLimit) {
        break; 
      }
    }

    console.log(`[DEBUG] query END: fetched ${events.length} events.`);
    if (events.length > 0) {
      console.log(`[DEBUG] Newest: ${events[0].created_at}, Oldest: ${events[events.length-1].created_at}`);
    }

    // feed.js の state.oldest 更新用に配列を返す
    return events;

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
