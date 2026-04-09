import { app } from './appCore.js';

// 文字列のエスケープ処理
app.esc = function(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};

// HTML文字列をDOM要素に変換
app.createHTMLElement = function(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstChild;
};

// バッチサイズの表示更新
app.updateBatchDisplay = function() {
  document.querySelectorAll('.batch-num').forEach(el => el.innerText = this.batchSize);
};

// Unixタイムスタンプを日時にフォーマット
app.formatTime = function(unix) {
  const date = new Date(unix * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
