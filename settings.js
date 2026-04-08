import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

app.loadSettings = function() {
  const r = localStorage.getItem('nostr_relays');
  this.relayUrls = r ? r.split('\n').filter(url => url.trim()) : DEFAULT_CONFIG.relays;
  this.batchSize = parseInt(localStorage.getItem('nostr_batch_size')) || DEFAULT_CONFIG.batchSize;
  document.getElementById('relay-input').value = this.relayUrls.join('\n');
  document.getElementById('batch-input').value = this.batchSize;
};

app.saveSettings = function() {
  localStorage.setItem('nostr_relays', document.getElementById('relay-input').value);
  localStorage.setItem('nostr_batch_size', document.getElementById('batch-input').value);
  location.reload();
};
