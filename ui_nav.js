import { app } from './appCore.js';

app.openProfile = function(pubkey) {
  if (!pubkey) return;
  window.open(`https://sugishun-tech.github.io/mynostr_profile/?hex=${pubkey}`, '_blank');
};


app.openThread = async function(eventId) {
  this.previousTab = this.activeTab;
  this.currentThreadId = eventId;
  this.switchTab('thread');

  // 1. 各コンテナの取得と初期化
  const containers = {
    parent: document.getElementById('thread-parent-post'),
    main: document.getElementById('thread-main-post'),
    replies: document.getElementById('timeline-thread')
  };

  Object.values(containers).forEach(el => {
    if (el) {
      el.innerHTML = '';
      el.classList.remove('hidden'); 
      el.style.display = '';
    }
  });

  // 2. 主役の投稿を取得 (getSingleEventで即座に取得して待つ)
  const ev = await this.getSingleEvent([{ ids: [eventId] }]);
  if (!ev) return; // 取得失敗時は終了
  
  this.renderPost(ev, false, 'thread-main-post');

  // 3. 親の取得 (非同期で走らせる)
  const fetchParent = async () => {
    const eTags = ev.tags.filter(t => t[0] === 'e');
    if (eTags.length > 0) {
      const parentTag = eTags.find(t => t[3] === 'reply') || eTags[eTags.length - 1];
      const pEv = await this.getSingleEvent([{ ids: [parentTag[1]] }]);
      if (pEv) this.renderPost(pEv, false, 'thread-parent-post');
    }
  };

  // 4. 子（リプライ）の取得 (複数来るので既存のqueryで逐次描画)
  const fetchReplies = () => {
    this.query([{ kinds: [1], '#e': [ev.id] }], (childEv) => {
      const isDirectReply = childEv.tags.some(t => t[0] === 'e' && t[1] === ev.id);
      if (isDirectReply) {
        if (containers.replies && containers.replies.classList.contains('hidden')) {
          containers.replies.classList.remove('hidden');
        }
        this.renderPost(childEv, false, 'timeline-thread');
      }
    });
  };

  // 親の取得と子の取得を同時にスタート
  fetchParent();
  fetchReplies();
};


app.switchTab = function(tab) {
  this.activeTab = tab;
  document.querySelectorAll('.timeline, #page-setting, #post-area, #page-profile, #page-thread, #page-mutelist').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
  
  const navEl = document.getElementById(`nav-${tab}`);
  if (navEl) navEl.classList.add('active');

  const titles = { public: 'グローバル', home: 'ホーム', notifications: '通知', setting: '設定', thread: 'スレッド'};
  document.getElementById('header-title').innerText = titles[tab] || '';

  if (tab === 'setting') {
    document.getElementById('page-setting').classList.remove('hidden');
  } else if (tab === 'thread') {
    document.getElementById('page-thread').classList.remove('hidden');
  } else {
    document.getElementById(`timeline-${tab}`).classList.remove('hidden');
    if (tab === 'home' || tab === 'public') document.getElementById('post-area').classList.remove('hidden');
    
    // タブが空っぽなら初期取得
    if (document.getElementById(`timeline-${tab}`).children.length === 0 && this.fetchFeed) {
      this.fetchFeed('older');
    }
  }
};
