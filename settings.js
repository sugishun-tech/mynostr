import { app } from './appCore.js';
import { DEFAULT_CONFIG } from './config.js';

app._splitLines = function(value) {
  return (value || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
};

app._hasLocalSettings = function() {
  return [
    'nostr_relays',
    'nostr_batch_size',
    'nostr_mute_display_name_patterns',
    'nostr_mute_content_patterns',
    'nostr_muted_pubkeys'
  ].some(key => localStorage.getItem(key) !== null);
};

app._loadDefaultSettings = async function() {
  try {
    const res = await fetch('./default.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`default.json load failed: ${res.status}`);

    const data = await res.json();

    return {
      relays: Array.isArray(data.relays) ? data.relays : DEFAULT_CONFIG.relays,
      batchSize: Number.isFinite(parseInt(data.batchSize))
        ? parseInt(data.batchSize)
        : DEFAULT_CONFIG.batchSize,
      muteDisplayNamePatterns: Array.isArray(data.muteDisplayNamePatterns)
        ? data.muteDisplayNamePatterns
        : [],
      muteContentPatterns: Array.isArray(data.muteContentPatterns)
        ? data.muteContentPatterns
        : [],
      mutedPubkeys: Array.isArray(data.mutedPubkeys)
        ? data.mutedPubkeys
        : []
    };
  } catch (e) {
    console.warn('default.json の読み込みに失敗したので config.js を使います', e);

    return {
      relays: DEFAULT_CONFIG.relays,
      batchSize: DEFAULT_CONFIG.batchSize,
      muteDisplayNamePatterns: [],
      muteContentPatterns: [],
      mutedPubkeys: []
    };
  }
};

app.loadSettings = async function() {
  let settings;

  if (this._hasLocalSettings()) {
    settings = {
      relays: this._splitLines(localStorage.getItem('nostr_relays')),
      batchSize: parseInt(localStorage.getItem('nostr_batch_size')) || DEFAULT_CONFIG.batchSize,
      muteDisplayNamePatterns: this._splitLines(localStorage.getItem('nostr_mute_display_name_patterns')),
      muteContentPatterns: this._splitLines(localStorage.getItem('nostr_mute_content_patterns')),
      mutedPubkeys: this._splitLines(localStorage.getItem('nostr_muted_pubkeys')).map(s => s.toLowerCase())
    };

    if (settings.relays.length === 0) {
      settings.relays = DEFAULT_CONFIG.relays;
    }
  } else {
    settings = await this._loadDefaultSettings();
  }

  this.relayUrls = settings.relays;
  this.batchSize = settings.batchSize;
  this.muteDisplayNamePatterns = settings.muteDisplayNamePatterns;
  this.muteContentPatterns = settings.muteContentPatterns;
  this.mutedPubkeys = new Set(settings.mutedPubkeys.map(s => s.toLowerCase()));

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

      document.getElementById('relay-input').value =
        Array.isArray(data.relays) ? data.relays.join('\n') : '';

      document.getElementById('batch-input').value =
        data.batchSize || DEFAULT_CONFIG.batchSize;

      document.getElementById('mute-display-name-input').value =
        Array.isArray(data.muteDisplayNamePatterns)
          ? data.muteDisplayNamePatterns.join('\n')
          : '';

      document.getElementById('mute-content-input').value =
        Array.isArray(data.muteContentPatterns)
          ? data.muteContentPatterns.join('\n')
          : '';

      document.getElementById('mute-pubkey-input').value =
        Array.isArray(data.mutedPubkeys)
          ? data.mutedPubkeys.join('\n')
          : '';

      this.saveSettings();
    } catch (e) {
      alert('設定JSONの読み込みに失敗しました');
      console.error(e);
    }
  };

  input.click();
};
