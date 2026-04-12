// appCore.js
import { NostrFetcher } from 'https://cdn.jsdelivr.net/npm/nostr-fetch@0.16.0/+esm';
import { SimplePool } from 'https://cdn.jsdelivr.net/npm/nostr-tools@1.17.0/+esm'; 

export const app = {
  myPubkey: "",
  fetcher: NostrFetcher.init(),
  pool: new SimplePool(), // 追加
  relayUrls: [], // settings.js で読み込まれます
  eventStorage: new Map(),
  profiles: new Map(),
  nip05Status: new Map(),
  likedIds: new Set(),
  following: new Set(),
  
  activeTab: 'public',
  previousTab: null,
  currentProfilePubkey: null,
  currentThreadId: null,
  
  state: {
    public:  { newest: Math.floor(Date.now()/1000), oldest: Math.floor(Date.now()/1000) },
    home:    { newest: Math.floor(Date.now()/1000), oldest: Math.floor(Date.now()/1000) },
    profile: { newest: Math.floor(Date.now()/1000), oldest: Math.floor(Date.now()/1000) },
    notifications: { newest: Math.floor(Date.now()/1000), oldest: Math.floor(Date.now()/1000) },
    thread:  { newest: Math.floor(Date.now()/1000), oldest: Math.floor(Date.now()/1000) }
  }
};
