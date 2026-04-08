import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

app.login = async function() {
  if (!window.nostr) return alert("NIP-07拡張機能（nos2x等）が見つかりません");
  try {
    this.myPubkey = await window.nostr.getPublicKey();
    document.getElementById('login-btn').classList.add('hidden');
    document.getElementById('profile-display').classList.remove('hidden');
    document.getElementById('post-avatar').classList.remove('hidden');
    
    this.fetchProfile(this.myPubkey, (p) => {
      document.getElementById('my-name').innerText = p.display_name || p.name || "User";
      const iconUrl = p.picture || DEFAULT_CONFIG.defaultIcon;
      document.getElementById('my-pic').src = iconUrl;
      document.getElementById('post-avatar').src = iconUrl;
    });
    
    this.query([{ kinds: [7], authors: [this.myPubkey] }], (ev) => {
      const eTag = ev.tags.find(t => t[0] === 'e');
      if (eTag) this.likedIds.add(eTag[1]);
    });

    this.query([{ kinds: [3], authors: [this.myPubkey], limit: 1 }], (ev) => {
      this.following = new Set(ev.tags.filter(t => t[0] === 'p').map(t => t[1]));
      if(this.activeTab === 'home') this.fetchFeed('older');
    });
  } catch (e) { console.error("Login failed:", e); }
};
