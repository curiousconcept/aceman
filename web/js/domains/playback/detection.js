// Detection of host-side players + browsers.
//
// Both feeds come from the broker (host-side allow-list). We never spawn
// players directly — the OS scheme handler routes acestream:// to the
// shell wrapper which reads the same default_player config we write.
//
// The detected lists + current-browser slot are read by the playback
// card's renderPlaybackTargets (still in app.js), and loadPlayers/
// loadBrowsers call it after refreshing — a transitional cycle until
// playback is its own module.

import { api } from '../../shared/api.js';
import { browserLabel, detectBrowserFromNav } from './lib/browsers.js';
import { renderPlaybackTargets } from './playback.js';

export let detectedPlayers = [];   // [{name, source}]
export let detectedBrowsers = [];  // [{name, source}]

// Fetch the available[] list with a one-shot retry when the server
// signals broker_error:true. That sentinel comes from the route's
// degrade-on-EngineError path: a 200 with an empty list because the
// broker call failed (typically a cold `flatpak list` blowing the
// 10 s broker.call timeout). Without the retry the user is stuck
// staring at an empty dropdown until they reload the page; with it,
// the second call lands after the broker's flatpak cache is warm
// and the real list shows up.
async function _loadDetected(url) {
  let r;
  try { r = await api(url); }
  catch (_) { return []; }
  if (r && r.broker_error) {
    // 2 s lets a slow first flatpak/list call finish AND warms the
    // broker's per-module cache so the retry probe is a hash lookup
    // rather than another subprocess fork+exec. The retry itself is
    // best-effort: if it ALSO comes back broker_error, we accept
    // the empty list and stop retrying (no infinite loop).
    await new Promise(res => setTimeout(res, 2000));
    try { r = await api(url); } catch (_) { return []; }
  }
  return Array.isArray(r && r.available) ? r.available : [];
}

export async function loadPlayers() {
  detectedPlayers = await _loadDetected('/api/players');
  renderPlaybackTargets();
}

export async function loadBrowsers() {
  detectedBrowsers = await _loadDetected('/api/browsers');
  renderPlaybackTargets();
}

// Display-name mapping + UA detection live in ./lib/browsers.js.
// We keep `_currentBrowserName` as a wired-in slot so the renderer
// can read it synchronously after init resolves.
const _browserLabel = browserLabel;
export let _currentBrowserName = '';
export async function detectCurrentBrowser() {
  _currentBrowserName = await detectBrowserFromNav({
    userAgent: navigator.userAgent || '',
    brave: navigator.brave || null,
  });
}

// (Browsers are rendered as options inside the unified "Play in"
// dropdown by renderPlaybackTargets — no dedicated browser
// dropdown / button anymore.)
