export const app = {
  myPubkey: "",
  relays: [],
  eventStorage: new Map(),
  profiles: new Map(),
  nip05Status: new Map(),
  likedIds: new Set(),
  following: new Set(),
  subscriptions: new Map(),
  
  activeTab: 'public',
  previousTab: null,
  currentProfilePubkey: null,
  currentThreadId: null,
  
  state: {
    public:  { newest: 0, oldest: Math.floor(Date.now()/1000) },
    home:    { newest: 0, oldest: Math.floor(Date.now()/1000) },
    profile: { newest: 0, oldest: Math.floor(Date.now()/1000) },
    notifications: { newest: 0, oldest: Math.floor(Date.now()/1000) },
    thread:  { newest: 0, oldest: Math.floor(Date.now()/1000) }
  }
};
