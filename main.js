import { app } from './appCore.js';
import './settings.js';
import './network.js?20260831-relay-v2';
import './auth.js';
import './actions.js?20260831-relay-v2';
import './feed.js';
import './profile.js';
import './utils.js';
import './ui_render.js';
import './ui_nav.js';


app.init = async function() {
  await this.loadSettings();
  this.connectRelays();
  this.updateBatchDisplay();
  await this.initRouting();
};


window.app = app;

app.init().catch(e => {
  console.error('アプリの初期化に失敗しました', e);
});
