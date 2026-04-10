import { SimplePool } from 'https://esm.sh/nostr-tools@2.7.0';

export const app = {
  myPubkey: "",
  pool: new SimplePool(),
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
