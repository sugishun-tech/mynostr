import { app } from './appCore.js';

app.submitPost = async function() {
  if (!this.myPubkey) return alert("ログインが必要です");
  const inputArea = document.getElementById('post-input');
  const content = inputArea.value.trim();
  if (!content) return;

  const event = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: content };
  try {
    const signedEvent = await window.nostr.signEvent(event);
    this.broadcast(signedEvent);
    inputArea.value = '';
    this.eventStorage.set(signedEvent.id, signedEvent);
    if (this.activeTab === 'home' || this.activeTab === 'public') {
      this.renderPost(signedEvent, true);
    }
  } catch (e) { alert("投稿に失敗しました"); }
};

app.submitReply = async function() {
  if (!this.myPubkey || !this.currentThreadId) return alert("エラー: 対象が存在しません");
  const inputArea = document.getElementById('reply-input');
  const content = inputArea.value.trim();
  if (!content) return;

  const parentEvent = this.eventStorage.get(this.currentThreadId);
  let tags = [["e", this.currentThreadId, "", "reply"]];
  if (parentEvent) {
    tags.push(["p", parentEvent.pubkey]);
    // 返信ツリーの参加者にも通知が行くようにpタグを追加
    parentEvent.tags.filter(t => t[0] === 'p').forEach(t => {
      if (t[1] !== this.myPubkey && !tags.some(ex => ex[0] === 'p' && ex[1] === t[1])) {
        tags.push(["p", t[1]]);
      }
    });
  }

  const event = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: tags, content: content };
  try {
    const signedEvent = await window.nostr.signEvent(event);
    this.broadcast(signedEvent);
    inputArea.value = '';
    this.eventStorage.set(signedEvent.id, signedEvent);
    
    // 送信完了後、スレッドを開き直して反映させる
    this.openThread(this.currentThreadId);
  } catch (e) { alert("返信に失敗しました"); }
};

app.toggleLike = async function(id, pubkey) {
  if (!this.myPubkey) return alert("ログインしてください");
  if (this.likedIds.has(id)) return;

  const ev = { kind: 7, created_at: Math.floor(Date.now()/1000), tags: [["e", id], ["p", pubkey]], content: "+" };
  try {
    const signed = await window.nostr.signEvent(ev);
    this.broadcast(signed);
    this.likedIds.add(id);
    document.querySelectorAll(`[data-event-id="${id}"] .heart-btn`).forEach(btn => {
      btn.innerHTML = '♥';
      btn.classList.add('liked');
    });
  } catch(e) { console.error(e); }
};
