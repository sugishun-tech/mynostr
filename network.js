// network.js
import { app } from './appCore.js';

app._eventQueue = app._eventQueue || new Set();
app._eventCallbacks = app._eventCallbacks || [];
app._eventTimer = app._eventTimer || null;

app.connectRelays = function() {};

app.broadcast = async function(signedEvent) {
  console.log("Broadcasting to:", this.relayUrls);

  if (!this.relayUrls || this.relayUrls.length === 0) {
    console.error("No relays configured.");
    return;
  }

  try {
    await Promise.any(this.pool.publish(this.relayUrls, signedEvent));
    console.log("[SUCCESS] Event published successfully to at least one relay.");
  } catch (e) {
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
  const pubs = this.pool.publish(this.relayUrls, signedEvent);
  const promises = pubs.map(pub => {
    return new Promise((resolve, reject) => {
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
    await Promise.any(promises);
    console.log("Broadcast successful at least one relay");
  } catch (e) {
    console.error("Broadcast failed on all relays:", e);
    throw e;
  }
};

app._matchesFilter = function(ev, filter) {
  if (filter.ids && !filter.ids.includes(ev.id)) return false;
  if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
  if (filter.authors && !filter.authors.includes(ev.pubkey)) return false;
  if (filter.since && ev.created_at < filter.since) return false;
  if (filter.until && ev.created_at > filter.until) return false;

  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#')) continue;
    const tagName = key.slice(1);
    const values = filter[key];
    const hasTag = (ev.tags || []).some(t => t[0] === tagName && values.includes(t[1]));
    if (!hasTag) return false;
  }
  return true;
};

/**
 * タイムライン取得。
 * - filters[0] だけではなく、分割filterを全部処理する。
 * - 1つの巨大authors filterを避けるため、feed.js側で分割したfilter配列を受け取れる。
 * - EOSEを即終了扱いにしない。速いリレーだけで打ち切ると、ホームタイムラインが飛び飛びになるため。
 */
app.query = async function(filters, onEvent) {
  const rawFilters = (Array.isArray(filters) ? filters : [filters]).filter(Boolean);
  if (rawFilters.length === 0) return [];

  const limits = rawFilters.map(f => Number(f.limit || 0)).filter(n => n > 0);
  const fetchLimit = limits.length > 0 ? Math.max(...limits) : null;
  const shouldLimitFinal = fetchLimit !== null;

  console.log(`[DEBUG] query START: filters=${rawFilters.length}, limit=${fetchLimit || 'none'}`);

  try {
    return new Promise((resolve) => {
      const eventMap = new Map();
      const sub = this.pool.sub(this.relayUrls, rawFilters);
      let isFinished = false;
      let eoseTimer = null;

      sub.on('event', (ev) => {
        if (!rawFilters.some(filter => this._matchesFilter(ev, filter))) return;
        if (!eventMap.has(ev.id)) eventMap.set(ev.id, ev);
      });

      const finish = () => {
        if (isFinished) return;
        isFinished = true;
        if (eoseTimer) clearTimeout(eoseTimer);
        sub.unsub();

        let finalEvents = Array.from(eventMap.values()).sort((a, b) => {
          if (b.created_at !== a.created_at) return b.created_at - a.created_at;
          return b.id.localeCompare(a.id);
        });

        if (shouldLimitFinal) finalEvents = finalEvents.slice(0, fetchLimit);

        finalEvents.forEach(ev => {
          if (onEvent) onEvent(ev);
        });

        console.log(`[DEBUG] query END: fetched ${finalEvents.length} events.`);
        resolve(finalEvents);
      };

      sub.on('eose', () => {
        if (eoseTimer) clearTimeout(eoseTimer);
        eoseTimer = setTimeout(finish, 900);
      });

      setTimeout(finish, 5000);
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
