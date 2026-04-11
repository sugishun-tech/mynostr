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

        // 複数人のプロフィールを1回のREQで一括取得
        const evs = await this.query([{ kinds: [0], authors: pubkeys }]);
        
        evs.forEach(ev => {
          try {
            const data = JSON.parse(ev.content);
            this.profiles.set(ev.pubkey, data);
          } catch(e) { console.error("プロフィール解析エラー", e); }
        });

        callbacks.forEach(({ pubkey, cb }) => {
          // 何度も無駄に再取得するのを防ぐため、見つからなかった場合は空オブジェクトを入れる
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
