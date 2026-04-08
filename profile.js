import { app } from './appCore.js';

app.fetchProfile = function(pubkey, cb) {
  if (this.profiles.has(pubkey)) return cb(this.profiles.get(pubkey));
  this.query([{ kinds: [0], authors: [pubkey], limit: 1 }], (ev) => {
    try {
      const data = JSON.parse(ev.content);
      this.profiles.set(pubkey, data);
      cb(data);
    } catch(e) {}
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
