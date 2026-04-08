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
  const subId = "sub_" + Math.random().toString(36).substring(7);
  this.subscriptions.set(subId, onEvent);
  this.relays.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["REQ", subId, ...filters]));
  });
  setTimeout(() => {
    this.relays.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
    });
    this.subscriptions.delete(subId);
  }, 4000);
};
