// profile.js
import { app } from './appCore.js';

app._profileQueue = new Set();
app._profileCallbacks = [];
app._profileTimer = null;

app.fetchProfile = function(pubkey, cb) {
  if (this.profiles.has(pubkey)) {
    const p = this.profiles.get(pubkey);
    if (cb) cb(p);
    return Promise.resolve(p);
  }

  return new Promise((resolve) => {
    this._profileQueue.add(pubkey);
    this._profileCallbacks.push({ pubkey, cb: (data) => { if(cb) cb(data); resolve(data); } });

    if (!this._profileTimer) {
      this._profileTimer = setTimeout(async () => {
        const pubkeys = Array.from(this._profileQueue);
        const callbacks = [...this._profileCallbacks];
        
        this._profileQueue.clear();
        this._profileCallbacks = [];
        this._profileTimer = null;

        if (pubkeys.length === 0) return;

        try {
          // nostr-fetch の機能を使って、各著者の "最新のKind 0 (プロフィール)" を効率よく取得
          const iter = app.fetcher.fetchLastEventPerAuthor(
            { authors: pubkeys, relayUrls: this.relayUrls },
            { kinds: [0] }
          );
          
          for await (const { author, event } of iter) {
            if (event) {
              try {
                const data = JSON.parse(event.content);
                this.profiles.set(author, data);
              } catch(e) { console.error("プロフィール解析エラー", e); }
            } else {
              // 見つからなかった場合は空オブジェクトを入れて無駄な再取得を防ぐ
              this.profiles.set(author, {});
            }
          }
        } catch(e) { console.error("Profile fetch error", e); }

        callbacks.forEach(({ pubkey, cb }) => {
          if (!this.profiles.has(pubkey)) {
            this.profiles.set(pubkey, {}); 
          }
          cb(this.profiles.get(pubkey) || null);
        });
      }, 100);
    }
  });
};

app.verifyNip05 = async function(nip05, pubkey) {
  if (this.nip05Status.has(nip05)) return;
  this.nip05Status.set(nip05, 'pending');
  try {
    const [name, domain] = nip05.split('@');
    const res = await fetch(`https://${domain}/.well-known/nostr.json?name=${name}`);
    const data = await res.json();
    const isValid = data.names && data.names[name] === pubkey;
    this.nip05Status.set(nip05, isValid);
    this.updateUIPost(pubkey);
  } catch {
    this.nip05Status.set(nip05, false);
    this.updateUIPost(pubkey);
  }
};
