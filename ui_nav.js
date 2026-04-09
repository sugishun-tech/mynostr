import { app } from './appCore.js';

app.openProfile = function(pubkey) {
  if (!pubkey) return;
  window.open(`https://sugishun-tech.github.io/mynostr_profile/?hex=${pubkey}`, '_blank');
};

app.openThread = function(eventId) {
  this.previousTab = this.activeTab;
  this.currentThreadId = eventId;
  this.switchTab('thread');

  // 1. 各コンテナの取得
  const containerParent = document.getElementById('thread-parent-post');
  const containerMain = document.getElementById('thread-main-post');
  const containerReplies = document.getElementById('timeline-thread');

  // 2. 初期化（中身を空にする）
  [containerParent, containerMain, containerReplies].forEach(el => {
    if (el) {
      el.innerHTML = '';
      // --- 原因徹底追及の修正点：hiddenを強制解除 ---
      el.classList.remove('hidden'); 
      el.style.display = ''; // style属性で直接消されてる場合も考慮
    }
  });

  // 3. イベント取得（キャッシュ無視の生クエリ）
  this.query([{ ids: [eventId] }], (ev) => {
    // 主役を表示
    this.renderPost(ev, false, 'thread-main-post');

    // 親の取得
    const eTags = ev.tags.filter(t => t[0] === 'e');
    if (eTags.length > 0) {
      const parentTag = eTags.find(t => t[3] === 'reply') || eTags[eTags.length - 1];
      this.query([{ ids: [parentTag[1]] }], (pEv) => {
        this.renderPost(pEv, false, 'thread-parent-post');
      });
    }

    // 子（リプライ）の取得
    this.query([{ kinds: [1], '#e': [ev.id] }], (childEv) => {
      // タグの中に自分のIDがあれば子とみなす（一番確実な判定）
      const isDirectReply = childEv.tags.some(t => t[0] === 'e' && t[1] === ev.id);

      if (isDirectReply) {
        // レンダリング直前にも念のためコンテナの非表示をチェック
        if (containerReplies && containerReplies.classList.contains('hidden')) {
          containerReplies.classList.remove('hidden');
        }
        this.renderPost(childEv, false, 'timeline-thread');
      }
    });
  });
};

app.openThread_old = function(eventId) {
  this.previousTab = this.activeTab;
  this.currentThreadId = eventId;
  this.switchTab('thread');

  const containerParent = document.getElementById('thread-parent-post');
  const containerMain = document.getElementById('thread-main-post');
  const containerReplies = document.getElementById('timeline-thread');

  containerParent.innerHTML = '';
  containerMain.innerHTML = '';
  containerReplies.innerHTML = '';

  const renderThreadContext = (ev) => {
    this.renderPost(ev, false, 'thread-main-post');

    const eTags = ev.tags.filter(t => t[0] === 'e');
    if (eTags.length > 0) {
      const parentTag = eTags.find(t => t[3] === 'reply') || eTags[0];
      this.query([{ ids: [parentTag[1]] }], (pEv) => {
        this.renderPost(pEv, false, 'thread-parent-post');
      });
    }

    if (this.query) {
      this.query([{ kinds: [1], '#e': [ev.id], limit: 30 }], (childEv) => {
        const cTags = childEv.tags.filter(t => t[0] === 'e');
        const directReplyTag = cTags.find(t => t[3] === 'reply') || cTags[cTags.length - 1];
        if (directReplyTag && directReplyTag[1] === ev.id) {
          if(this.eventStorage) this.eventStorage.set(childEv.id, childEv);
          this.renderPost(childEv, false, 'timeline-thread');
        }
      });
    }
  };

  const targetEv = this.eventStorage ? this.eventStorage.get(eventId) : null;
  if (targetEv) {
    renderThreadContext(targetEv);
  } else {
    this.query([{ ids: [eventId] }], (ev) => {
      if(this.eventStorage) this.eventStorage.set(ev.id, ev);
      renderThreadContext(ev);
    });
  }
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
