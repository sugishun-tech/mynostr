import { app } from './appCore.js';

app.connectRelays = function() {
  this.relays.forEach(ws => ws.close());
  this.relays = [];
  this.relayUrls.forEach(url => {
    const ws = new WebSocket(url.trim());
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] === "EVENT" && this.subscriptions.has(data[1])) {
          this.subscriptions.get(data[1])(data[2]);
        }
      } catch(e) {}
    };
    this.relays.push(ws);
  });
};

app.broadcast = function(signedEvent) {
  this.relays.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["EVENT", signedEvent]));
  });
};


app.query = function(filters, onEvent) {
  return new Promise((resolve) => {
    const subId = "sub_" + Math.random().toString(36).substring(7);
    const collectedEvents = []; // 収集用

    this.subscriptions.set(subId, (ev) => {
      collectedEvents.push(ev);
      if (onEvent) onEvent(ev); // 既存の逐次描画コールバックも維持
    });

    this.relays.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["REQ", subId, ...filters]));
    });

    setTimeout(() => {
      this.relays.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
      });
      this.subscriptions.delete(subId);
      resolve(collectedEvents); // 4秒後に取得した全イベントを返す
    }, 4000);
  });
};

// 新設: 1件見つかった瞬間にサブスクリプションを閉じて即座にresolveする
app.getSingleEvent = function(filters) {
  return new Promise((resolve) => {
    const subId = "sub_" + Math.random().toString(36).substring(7);
    let handled = false;

    const closeSub = () => {
      this.relays.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
      });
      this.subscriptions.delete(subId);
    };

    this.subscriptions.set(subId, (ev) => {
      if (!handled) {
        handled = true;
        closeSub(); // 1件見つけたら即座に通信を打ち切る（爆速化）
        resolve(ev);
      }
    });

    this.relays.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["REQ", subId, ...filters]));
    });

    // 4秒待っても来なければ null で諦める
    setTimeout(() => {
      if (!handled) {
        handled = true;
        closeSub();
        resolve(null);
      }
    }, 4000);
  });
};
