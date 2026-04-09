import { app } from './appCore.js';

app.fetchProfile = async function(pubkey, cb) {
  // すでにキャッシュがあれば即返す
  if (this.profiles.has(pubkey)) {
    const p = this.profiles.get(pubkey);
    if (cb) cb(p);
    return p;
  }
  
  // getSingleEventを使って1件取得
  const ev = await this.getSingleEvent([{ kinds: [0], authors: [pubkey], limit: 1 }]);
  
  if (ev) {
    try {
      const data = JSON.parse(ev.content);
      this.profiles.set(pubkey, data);
      if (cb) cb(data); // 既存のコールバック互換性も維持
      return data;
    } catch(e) {
      console.error("プロフィール解析エラー", e);
    }
  }
  return null;
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
