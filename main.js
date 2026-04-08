import { app } from './appCore.js';
import './settings.js';
import './network.js';
import './auth.js';
import './actions.js';
import './feed.js';
import './profile.js';
import './ui.js';

app.init = async function() {
  this.loadSettings();
  this.connectRelays();
  this.updateBatchDisplay();
};

// HTML側からの呼び出し (onclick="app.openProfile(...)" など) が
// 従来通り動作するように window オブジェクトに紐付ける
window.app = app;

// アプリの起動
app.init();
