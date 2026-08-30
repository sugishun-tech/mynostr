// network.js
import { app } from './appCore.js';

app._eventQueue = app._eventQueue || new Set();
app._eventCallbacks = app._eventCallbacks || [];
app._eventTimer = app._eventTimer || null;

app.connectRelays = function() {};

const DEFAULT_PUBLISH_TIMEOUT_MS = 8000;

app._getPublishRelayUrls = function() {
  return Array.from(new Set(
    (Array.isArray(this.relayUrls) ? this.relayUrls : [])
      .map(url => String(url).trim())
      .filter(Boolean)
  ));
};

app._publishWithTimeout = function(publishPromise, relayUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error(`${relayUrl}: ${timeoutMs}ms以内に応答がありませんでした`));
    }, timeoutMs);

    Promise.resolve(publishPromise).then(
      () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(relayUrl);
      },
      (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        const reason = error instanceof Error
          ? error.message
          : String(error || '送信を拒否されました');
        reject(new Error(`${relayUrl}: ${reason}`));
      }
    );
  });
};

/**
 * 署名済みイベントを、設定された全リレーへ同時に複製送信する。
 * 1つ以上のリレーが受理した時点で呼び出し元へ成功を返すが、
 * 残りのリレーへの送信も中断せず、各結果をコンソールへ記録する。
 */
app.broadcast = async function(signedEvent) {
  const relayUrls = this._getPublishRelayUrls();

  if (relayUrls.length === 0) {
    const error = new Error('送信先リレーが設定されていません');
    console.error('[PUBLISH FAILED]', error);
    throw error;
  }

  if (!signedEvent || !signedEvent.id) {
    const error = new Error('署名済みイベントが不正です');
    console.error('[PUBLISH FAILED]', error);
    throw error;
  }

  console.log(
    `[PUBLISH START] kind=${signedEvent.kind} id=${signedEvent.id} relays=${relayUrls.length}`,
    relayUrls
  );

  let publishPromises;
  try {
    // nostr-tools 1.17.0 の SimplePool.publish() は、
    // リレーごとの Promise を一括生成し、全リレーへの送信を同時に開始する。
    publishPromises = this.pool.publish(relayUrls, signedEvent);
  } catch (error) {
    console.error('[PUBLISH FAILED] 送信開始に失敗しました', error);
    throw error;
  }

  if (!Array.isArray(publishPromises) || publishPromises.length !== relayUrls.length) {
    const error = new Error('リレー送信処理の戻り値が想定外です');
    console.error('[PUBLISH FAILED]', error);
    throw error;
  }

  const configuredTimeout = Number(this.publishTimeoutMs);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_PUBLISH_TIMEOUT_MS;

  const attempts = publishPromises.map((promise, index) => (
    this._publishWithTimeout(promise, relayUrls[index], timeoutMs)
  ));

  // 全結果の記録は、最初の成功を呼び出し元へ返した後も継続する。
  const completion = Promise.allSettled(attempts).then(results => {
    const succeeded = [];
    const failed = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded.push(relayUrls[index]);
      } else {
        failed.push({
          relay: relayUrls[index],
          reason: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        });
      }
    });

    console.log(
      `[PUBLISH COMPLETE] success=${succeeded.length}/${relayUrls.length}`,
      { succeeded, failed }
    );

    return { succeeded, failed };
  });

  try {
    const firstAcceptedRelay = await Promise.any(attempts);
    console.log(`[PUBLISH ACCEPTED] ${firstAcceptedRelay}`);

    // Promise.allSettled が各 rejection を処理するので、未処理例外にはならない。
    void completion;

    return {
      firstAcceptedRelay,
      relayCount: relayUrls.length,
      completion
    };
  } catch (error) {
    const result = await completion;
    const details = result.failed.map(item => item.reason).join(' / ');
    const publishError = new Error(
      details
        ? `すべてのリレーへの送信に失敗しました: ${details}`
        : 'すべてのリレーへの送信に失敗しました'
    );
    console.error('[PUBLISH FAILED]', publishError, error);
    throw publishError;
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
