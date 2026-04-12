// network.js
import { app } from './appCore.js';

app._eventQueue = app._eventQueue || new Set();
app._eventCallbacks = app._eventCallbacks || [];
app._eventTimer = app._eventTimer || null;

app.connectRelays = function() {};

app.broadcast = function(signedEvent) {
  this.pool.publish(this.relayUrls, signedEvent);
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
