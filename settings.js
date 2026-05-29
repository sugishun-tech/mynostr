import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

app.loadSettings = function() {
  const r = localStorage.getItem('nostr_relays');
  this.relayUrls = r ? r.split('\n').filter(url => url.trim()) : DEFAULT_CONFIG.relays;
  this.batchSize = parseInt(localStorage.getItem('nostr_batch_size')) || DEFAULT_CONFIG.batchSize;

  this.muteDisplayNamePatterns = this._splitLines(localStorage.getItem('nostr_mute_display_name_patterns'));
  this.muteContentPatterns = this._splitLines(localStorage.getItem('nostr_mute_content_patterns'));
  this.mutedPubkeys = new Set(this._splitLines(localStorage.getItem('nostr_muted_pubkeys')).map(s => s.toLowerCase()));

  document.getElementById('relay-input').value = this.relayUrls.join('\n');
  document.getElementById('batch-input').value = this.batchSize;
  const displayNameInput = document.getElementById('mute-display-name-input');
  const contentInput = document.getElementById('mute-content-input');
  const pubkeyInput = document.getElementById('mute-pubkey-input');
  if (displayNameInput) displayNameInput.value = this.muteDisplayNamePatterns.join('\n');
  if (contentInput) contentInput.value = this.muteContentPatterns.join('\n');
  if (pubkeyInput) pubkeyInput.value = Array.from(this.mutedPubkeys).join('\n');
};

app.saveSettings = function() {
  const relays = document.getElementById('relay-input').value;
  const batchSize = document.getElementById('batch-input').value;
  const muteDisplayName = document.getElementById('mute-display-name-input').value;
  const muteContent = document.getElementById('mute-content-input').value;
  const mutedPubkeys = document.getElementById('mute-pubkey-input').value;

  localStorage.setItem('nostr_relays', relays);
  localStorage.setItem('nostr_batch_size', batchSize);
  localStorage.setItem('nostr_mute_display_name_patterns', muteDisplayName);
  localStorage.setItem('nostr_mute_content_patterns', muteContent);
  localStorage.setItem('nostr_muted_pubkeys', mutedPubkeys);
  location.reload();
};

app.exportSettings = function() {
  const data = {
    relays: this._splitLines(document.getElementById('relay-input').value),
    batchSize: parseInt(document.getElementById('batch-input').value) || DEFAULT_CONFIG.batchSize,
    muteDisplayNamePatterns: this._splitLines(document.getElementById('mute-display-name-input').value),
    muteContentPatterns: this._splitLines(document.getElementById('mute-content-input').value),
    mutedPubkeys: this._splitLines(document.getElementById('mute-pubkey-input').value).map(s => s.toLowerCase())
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mynostr-settings.json';
  a.click();
  URL.revokeObjectURL(url);
};

app.importSettings = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      document.getElementById('relay-input').value = Array.isArray(data.relays) ? data.relays.join('\n') : '';
      document.getElementById('batch-input').value = data.batchSize || DEFAULT_CONFIG.batchSize;
      document.getElementById('mute-display-name-input').value = Array.isArray(data.muteDisplayNamePatterns) ? data.muteDisplayNamePatterns.join('\n') : '';
      document.getElementById('mute-content-input').value = Array.isArray(data.muteContentPatterns) ? data.muteContentPatterns.join('\n') : '';
      document.getElementById('mute-pubkey-input').value = Array.isArray(data.mutedPubkeys) ? data.mutedPubkeys.join('\n') : '';
      this.saveSettings();
    } catch (e) {
      alert('設定JSONの読み込みに失敗しました');
      console.error(e);
    }
  };
  input.click();
};
