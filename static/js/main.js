const { nip19 } = window.NostrTools;

let myPubkey = "";
let relayConnections = [];
let eventStorage = new Map(); // pubkey -> profile info (Kind 0)
let followingPubkeys = new Set();
let myFollowingEvent = null;

let timelineState = {
    home: { newest: 0, oldest: Math.floor(Date.now() / 1000) },
    public: { newest: 0, oldest: Math.floor(Date.now() / 1000) },
    profile: { newest: 0, oldest: Math.floor(Date.now() / 1000) }
};

let currentProfileContext = "";
let replyContext = { id: "", pubkey: "" };
let userSettings = { relays: [], mutePubkeys: new Set(), muteRegex: null };

const DEFAULT_ICON = "/static/default_profile.png";

window.onload = () => {
    loadSettings();
    connectRelays();
};

function loadSettings() {
    const defaultRelays = "wss://relay.nostr.band\nwss://nos.lol\nwss://relay.damus.io\nwss://relay-jp.nostr.wirednet.jp\nwss://yabu.me\nwss://r.kojira.io\nwss://nrelay-jp.c-stellar.net";
    const savedRelays = localStorage.getItem('nostr_relays') || defaultRelays;
    const savedMuteKeys = localStorage.getItem('nostr_mute_pubkeys') || "";
    const savedRegex = localStorage.getItem('nostr_mute_regex') || "";

    document.getElementById('relay-list').value = savedRelays;
    document.getElementById('mute-pubkeys').value = savedMuteKeys;
    document.getElementById('mute-regex').value = savedRegex;

    applySettingsData(savedRelays, savedMuteKeys, savedRegex);
}

function applySettingsData(relaysStr, muteStr, regexStr) {
    userSettings.relays = relaysStr.split('\n').map(r => r.trim()).filter(r => r);
    userSettings.mutePubkeys = new Set();
    muteStr.split('\n').map(k => k.trim()).filter(k => k).forEach(k => {
        try {
            if (k.startsWith('npub1')) userSettings.mutePubkeys.add(nip19.decode(k).data);
            else userSettings.mutePubkeys.add(k);
        } catch(e) {}
    });
    try { userSettings.muteRegex = regexStr ? new RegExp(regexStr, 'i') : null; } catch(e) { userSettings.muteRegex = null; }
}

function saveSettings() {
    const relays = document.getElementById('relay-list').value;
    const muteKeys = document.getElementById('mute-pubkeys').value;
    const regex = document.getElementById('mute-regex').value;
    localStorage.setItem('nostr_relays', relays);
    localStorage.setItem('nostr_mute_pubkeys', muteKeys);
    localStorage.setItem('nostr_mute_regex', regex);
    applySettingsData(relays, muteKeys, regex);
    connectRelays();
    alert("設定を保存しました");
}

function isMuted(event) {
    if (userSettings.mutePubkeys.has(event.pubkey)) return true;
    if (userSettings.muteRegex && userSettings.muteRegex.test(event.content)) return true;
    return false;
}

// --- ページ切り替え ---
function showPage(pageId) {
    document.querySelectorAll('main section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-menu li').forEach(li => li.classList.remove('active'));
    document.getElementById(`${pageId}-page`).style.display = 'block';
    const menu = document.getElementById(`menu-${pageId}`);
    if (menu) menu.classList.add('active');
}

// --- ログイン・通信 ---
async function login() {
    if (!window.nostr) return alert("NIP-07拡張機能が必要です");
    myPubkey = await window.nostr.getPublicKey();
    document.getElementById('login-btn').style.display = 'none';
    document.getElementById('profile-area').style.display = 'flex';
    
    fetchProfiles([myPubkey], (p) => {
        document.getElementById('my-name').innerText = p.display_name || p.name || "User";
        loadImage(document.getElementById('my-avatar'), p.picture);
    });
    setTimeout(fetchFollowingList, 1000);
}

function connectRelays() {
    relayConnections.forEach(ws => ws.close());
    relayConnections = userSettings.relays.map(url => {
        const ws = new WebSocket(url);
        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data[0] === "EVENT" && data[2].kind === 0) {
                const profile = JSON.parse(data[2].content);
                eventStorage.set(data[2].pubkey, profile);
                updateUIWithProfile(data[2].pubkey, profile);
            }
        };
        return ws;
    });
}


function fetchProfiles(pubkeys, callback) {
    const missing = pubkeys.filter(p => !eventStorage.has(p));
    pubkeys.filter(p => eventStorage.has(p)).forEach(p => callback(eventStorage.get(p), p));
    if (missing.length === 0) return;

    const subId = `sub-prof-${Math.random().toString(36).substr(2, 6)}`;
    sendSubscription(subId, { kinds: [0], authors: missing }, (event) => {
        try {
            const profile = JSON.parse(event.content);
            eventStorage.set(event.pubkey, profile);
            updateUIWithProfile(event.pubkey, profile);
            callback(profile, event.pubkey);
        } catch(e) {}
    }, 3000);
}

// --- タイムライン ---
function sendSubscription(id, filter, onEvent, timeout = 6000) {
    relayConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(["REQ", id, filter]));
            const listener = (msg) => {
                const data = JSON.parse(msg.data);
                if (data[0] === "EVENT" && data[1] === id) onEvent(data[2]);
                if (data[0] === "EOSE" && data[1] === id) ws.send(JSON.stringify(["CLOSE", id]));
            };
            ws.addEventListener('message', listener);
            setTimeout(() => {
                ws.removeEventListener('message', listener);
                if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["CLOSE", id]));
            }, timeout);
        }
    });
}

function fetchTimeline(type, isNew = false) {
    const now = Math.floor(Date.now() / 1000);
    let filter = { kinds: [1], limit: 40 };
    if (type === 'home') filter.authors = [...followingPubkeys, myPubkey];

    if (isNew) {
        filter.since = timelineState[type].newest || now;
        delete filter.limit;
    } else {
        filter.until = timelineState[type].oldest;
    }

    sendSubscription(`sub-${type}-${now}`, filter, (event) => {
        if (isMuted(event)) return;
        timelineState[type].newest = Math.max(timelineState[type].newest, event.created_at);
        timelineState[type].oldest = Math.min(timelineState[type].oldest, event.created_at);
        displayPost(event, `${type}-timeline`, isNew);
    });
}

function fetchProfilePosts(isNew = false) {
    const now = Math.floor(Date.now() / 1000);
    let filter = { kinds: [1], authors: [currentProfileContext], limit: 20 };
    if (isNew) {
        filter.since = timelineState.profile.newest || now;
        delete filter.limit;
    } else {
        filter.until = timelineState.profile.oldest;
    }
    sendSubscription(`sub-p-posts-${now}`, filter, (event) => {
        if (isMuted(event)) return;
        timelineState.profile.newest = Math.max(timelineState.profile.newest, event.created_at);
        timelineState.profile.oldest = Math.min(timelineState.profile.oldest, event.created_at);
        displayPost(event, 'profile-timeline', isNew);
    });
}

// --- プロフィールページ表示 ---
function openProfile(pubkey) {
    currentProfileContext = pubkey;
    timelineState.profile = { newest: 0, oldest: Math.floor(Date.now() / 1000) };
    showPage('profile');
    document.getElementById('profile-timeline').innerHTML = "";
    
    const npub = nip19.npubEncode(pubkey);
    document.getElementById('profile-npub').innerText = npub;
    document.getElementById('profile-hex').innerText = pubkey;
    updateFollowButton();

    fetchProfiles([pubkey], (p) => {
        updateUIWithProfile(pubkey, p);
    });
    fetchProfilePosts(false);
}

// --- フォロー機能 ---
function fetchFollowingList() {
    sendSubscription("sub-follow", { kinds: [3], authors: [myPubkey], limit: 1 }, (event) => {
        if (!myFollowingEvent || event.created_at > myFollowingEvent.created_at) {
            myFollowingEvent = event;
            followingPubkeys = new Set(event.tags.filter(t => t[0] === 'p').map(t => t[1]));
            updateFollowButton();
        }
    });
}

async function toggleFollow() {
    if (!myPubkey) return alert("ログインしてください");
    const isFollowing = followingPubkeys.has(currentProfileContext);
    let newTags = myFollowingEvent ? myFollowingEvent.tags.filter(t => t[0] === 'p' && t[1] !== currentProfileContext) : [];
    if (!isFollowing) newTags.push(["p", currentProfileContext]);
    
    await sendNostrEvent(3, myFollowingEvent ? myFollowingEvent.content : "", newTags);
    if (isFollowing) followingPubkeys.delete(currentProfileContext);
    else followingPubkeys.add(currentProfileContext);
    updateFollowButton();
}

function updateFollowButton() {
    const btn = document.getElementById('follow-btn');
    if (currentProfileContext === myPubkey || !myPubkey) { btn.style.display = 'none'; return; }
    btn.style.display = 'block';
    const isFollowing = followingPubkeys.has(currentProfileContext);
    btn.innerText = isFollowing ? "Unfollow" : "Follow";
    btn.className = isFollowing ? "following" : "";
}

async function sendNostrEvent(kind, content, tags = []) {
    if (!window.nostr) {
        alert("ログイン（NIP-07拡張機能）が必要です");
        return false;
    }
    
    try {
        let event = {
            kind,
            pubkey: myPubkey,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content
        };
        
        // 拡張機能で署名
        const signed = await window.nostr.signEvent(event);
        
        // 全てのリレーに送信
        let sendCount = 0;
        relayConnections.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(["EVENT", signed]));
                sendCount++;
            }
        });

        if (sendCount === 0) throw new Error("接続中のリレーがありません");
        return true;
    } catch (e) {
        console.error("Event signing/sending failed:", e);
        return false;
    }
}

// --- 画像読み込み（タイムアウトを削除） ---
function loadImage(imgElement, src) {
    if (!src || src.trim() === "") {
        imgElement.src = DEFAULT_ICON;
        return;
    }

    // 新しい画像オブジェクトを作成して読み込みを確認
    const tempImg = new Image();
    tempImg.src = src;

    tempImg.onload = () => {
        imgElement.src = src;
    };

    tempImg.onerror = () => {
        console.warn("画像の読み込みに失敗しました:", src);
        imgElement.src = DEFAULT_ICON;
    };
}

// --- プロフィール情報をUIに反映（認証バッジの復活とアイコン同期） ---
function updateUIWithProfile(pubkey, profile) {
    const displayName = escapeHTML(profile.display_name || profile.name || pubkey.substring(0, 8));
    const handleName = profile.name ? `@${escapeHTML(profile.name)}` : "";
    const picUrl = profile.picture;
    const nip05 = profile.nip05 || "";

    // 1. タイムライン上の各要素を一括更新
    document.querySelectorAll(`.user-pic-${pubkey}`).forEach(img => loadImage(img, picUrl));
    document.querySelectorAll(`.user-name-${pubkey}`).forEach(el => el.innerText = displayName);
    document.querySelectorAll(`.user-handle-${pubkey}`).forEach(el => el.innerText = handleName);
    
    // 認証バッジ（チェックマーク）の更新
    document.querySelectorAll(`.user-nip05-${pubkey}`).forEach(el => {
        el.innerHTML = nip05 ? `<span class="verified-sm" title="${escapeHTML(nip05)}">✓</span>` : "";
    });

    // 2. プロフィールページ（詳細画面）の更新
    if (currentProfileContext === pubkey) {
        const detailPic = document.getElementById('profile-detail-pic');
        if (detailPic) loadImage(detailPic, picUrl);
        
        const detailName = document.getElementById('profile-detail-name');
        if (detailName) detailName.innerText = displayName;
        
        const detailBio = document.getElementById('profile-detail-bio');
        if (detailBio) detailBio.innerText = profile.about || "";

        // プロフィール詳細の認証情報を更新
        const detailNip05 = document.getElementById('profile-nip05');
        if (detailNip05) {
            detailNip05.innerHTML = nip05 ? `<span class="verified">✓ ${escapeHTML(nip05)}</span>` : "";
        }
    }
}

// --- 投稿の表示（NIP-05用コンテナを維持） ---
function displayPost(event, containerId, prepend = true) {
    if (document.getElementById(`post-${event.id}`)) return;
    const container = document.getElementById(containerId);
    
    // 初回描画用のデータ取得
    const p = eventStorage.get(event.pubkey) || {};
    const displayName = escapeHTML(p.display_name || p.name || event.pubkey.substring(0, 8));
    const handleName = p.name ? `@${escapeHTML(p.name)}` : "";
    const nip05Html = p.nip05 ? `<span class="verified-sm" title="${escapeHTML(p.nip05)}">✓</span>` : "";

    const html = `
        <div class="post" id="post-${event.id}">
            <img src="${DEFAULT_ICON}" class="post-icon user-pic-${event.pubkey}" onclick="openProfile('${event.pubkey}')">
            <div class="post-content">
                <div class="post-header">
                    <span class="post-name user-name-${event.pubkey}" onclick="openProfile('${event.pubkey}')">${displayName}</span>
                    <span class="user-nip05-${event.pubkey}">${nip05Html}</span>
                    <span class="post-id user-handle-${event.pubkey}">${handleName}</span>
                </div>
                <div class="post-text">${escapeHTML(event.content)}</div>
                <div class="post-actions">
                    <button class="action-btn" onclick="prepareReply('${event.id}','${event.pubkey}', '${escapeHTML(event.content).replace(/'/g, "\\'")}')">💬</button>
                    <button id="like-btn-${event.id}" class="action-btn" onclick="like('${event.id}','${event.pubkey}')">❤️</button>
                </div>
            </div>
        </div>`;
    
    container.insertAdjacentHTML(prepend ? 'afterbegin' : 'beforeend', html);
    
    // プロフィールが未取得なら取得し、取得済みならUIに反映（画像含む）
    if (!eventStorage.has(event.pubkey)) {
        fetchProfiles([event.pubkey], () => {});
    } else {
        updateUIWithProfile(event.pubkey, eventStorage.get(event.pubkey));
    }
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function copyText(elementId) {
    navigator.clipboard.writeText(document.getElementById(elementId).innerText).then(() => alert("Copied!"));
}

async function submitPost() {
    const content = document.getElementById('post-input').value;
    if (!content) return;
    await sendNostrEvent(1, content);
    document.getElementById('post-input').value = "";
}

function prepareReply(id, p, text) {
    replyContext = { id, pubkey: p };
    document.getElementById('reply-to-text').innerText = text.substring(0, 50) + "...";
    document.getElementById('reply-modal').style.display = 'block';
}

function closeModal() { document.getElementById('reply-modal').style.display = 'none'; }

async function like(id, p) {
    const btn = document.getElementById(`like-btn-${id}`);
    
    // すでにいいね済みの場合は連打防止
    if (btn && btn.classList.contains('liked')) return;

    const success = await sendNostrEvent(7, "+", [["e", id], ["p", p]]);
    
    if (success) {
        if (btn) {
            btn.classList.add('liked');
            // オプション：数値をカウントアップさせる演出などもここに追加可能
        }
    } else {
        alert("いいねの送信に失敗しました。拡張機能の承認を確認してください。");
    }
}

async function submitModalReply() {
    const input = document.getElementById('modal-reply-input');
    const content = input.value;
    if (!content) return;

    // eタグ（イベントID）とpタグ（相手の公開鍵）を付与
    const success = await sendNostrEvent(1, content, [
        ["e", replyContext.id, "", "root"], 
        ["p", replyContext.pubkey]
    ]);

    if (success) {
        input.value = "";
        closeModal();
        alert("返信を送信しました");
    } else {
        alert("返信の送信に失敗しました");
    }
}


