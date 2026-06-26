// Playback domain — the "watch" core. Three intertwined surfaces that
// share the same live-stream state (`current`, `livePlaybackTarget`,
// `cfg`) and so live together:
//   * playback orchestration — play(), the Play-in target dropdown,
//     move-to-target, restart, the now-playing line, save-button sync;
//   * in-browser playback — the mpegts.js player over /api/stream/proxy,
//     plus buffer-health / stall / pre-roll timers;
//   * engine status + controls — the poll/settle state machine, the
//     start/stop toggle, the play-gate, the acestream:// hand-off.
//
// The pure logic (target encoding, buffer maths, button views, the
// engine settling state machine) lives in lib/playback/ + lib/engine/
// and is unit-tested; this module is the DOM + broker wiring.
//
// Forward imports from sibling domains: favourites (allFavs, loadFavs,
// updateSaveButton, browserFavs), search (refreshSearchSection,
// refreshClearButton), detection (player/browser lists), gpu (param
// builder + encode label). Plus the generic shared/notice component and
// the shared/runtime flags (mode, isWslMode). This domain owns the live
// stream state (current, livePlaybackTarget, cfg) + the search/history
// layout helper (alignSearchToInput, used by those sibling cards).

import { $, showError, showConfirm, showBusy, hideBusy } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { showNotice, dismissNotice } from '../../shared/notice.js';
import { parseId } from '../../lib/playback/content_id_parser.js';
import { EngineStatusState } from '../../lib/engine/engine_state.js';
import { encodeTarget, isExternal } from '../../lib/playback/playback_target.js';
import { KEYS } from '../../lib/storage_keys.js';
import { saveLastPlay, loadLastPlay, clearLastPlay } from '../../lib/playback/last_played_stream.js';
import { inBrowserPlaybackSupported } from '../../lib/playback/playback_feature_detect.js';
import { buildPlaybackOptions } from '../../lib/playback/playback_options.js';
import { decidePlaybackPath } from '../../lib/playback/playback_decision.js';
import { targetValueToConfig } from '../../lib/playback/playback_config.js';
import { clampBuffer, bufferedAhead, bufferReady } from '../../lib/playback/playback_buffer.js';
import { describePlayButton } from '../../lib/playback/play_stop_button.js';
import { describeMoveButton } from '../../lib/playback/move_stream_button.js';
import { describeEngineToggle } from '../../lib/engine/engine_start_stop_toggle.js';
import { resolveDisplayName } from '../../lib/favourites/playback_display_name.js';
import { describePlayButtonGate } from '../../lib/engine/play_button_gate.js';
import { allFavs, loadFavs, updateSaveButton, browserFavs } from '../favourites/favourites.js';
import { refreshSearchSection, refreshClearButton } from '../search/search.js';
import { detectedPlayers, detectedBrowsers, _currentBrowserName } from './detection.js';
import { buildGpuParams, gpuEncodeLabel } from '../gpu/gpu.js';
import { mode, isWslMode } from '../../shared/runtime.js';

// The active stream, just enough to drive the Save button: we no longer
// own the session (the host shell does via acestream:// dispatch), so
// there's no playback_url / command_url to remember.
export let current = null;     // { cid, name }
// setCurrent lets the bootstrap rehydrate `current` after a reload
// without violating the single-writer rule (imported bindings are
// read-only; only this module reassigns).
export function setCurrent(value) { current = value; }
// Where the active stream is actually playing, as a dropdown-value string
// ('browser' | 'external|name|source' | ''). Set when play() fires, NOT
// when the dropdown changes — the dropdown is the user's pending intent,
// this is reality. The "Move current stream here" button compares the two.
export let livePlaybackTarget = '';

// Server config blob (/api/config). The bootstrap loads it via setCfg.
export let cfg = {};
export function setCfg(value) { cfg = value; }

// Aligns the search-results / history dropdowns (and the play-hint) to
// the Watch input's box — they position themselves relative to the
// play-row, which this domain owns. Used by search, history, the engine
// play-gate, and the init ResizeObserver.
export function alignSearchToInput() {
  const playRow = document.querySelector('.play-row');
  if (!playRow) return;
  const section = $('search-section');
  const historySec = $('history-section');
  const hint = $('play-hint');
  const card = (section || hint || historySec) &&
    (section || hint || historySec).closest('.card');
  if (!card) return;
  const rowRect = playRow.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const padLeft = parseFloat(cs.paddingLeft);
  const padRight = parseFloat(cs.paddingRight);
  const cardContentW = cardRect.width - padLeft - padRight;
  const rawMl = Math.max(0, rowRect.left - cardRect.left - padLeft);
  const w = Math.min(rowRect.width, Math.max(0, cardContentW - rawMl)) + 'px';
  const ml = rawMl + 'px';
  if (section && section.style.display !== 'none') {
    section.style.width = w;
    section.style.marginLeft = ml;
  }
  if (historySec && historySec.style.display !== 'none') {
    historySec.style.width = w;
    historySec.style.marginLeft = ml;
  }
  if (hint) {
    hint.style.width = w;
    hint.style.marginLeft = ml;
  }
}

// Reminder that a setting change (buffer / GPU) only applies on the next
// stream start. Shown only while something is live — nothing to restart
// otherwise. Domain-specific notice built on the generic shared component.
export function notifyRestartNeeded() {
  if (!livePlaybackTarget) return;
  showNotice({
    id: 'restart-needed',
    message: 'Setting changed — restart the stream for it to take effect.',
    actionLabel: '↺ Restart stream',
    onAction: () => { dismissNotice('restart-needed'); restartStream(); },
  });
}

export function clearNowPlaying() {
  stopInBrowserPlayback();
  current = null;
  livePlaybackTarget = '';
  $('now-playing').style.display = 'none';
  setNowPlayingName('', '');
  setTabTitle('');
  refreshPlaybackMoveButton();
}

// ---- in-browser playback (mpegts.js + /api/stream/proxy) ---------------
//
// The library transmuxes MPEG-TS chunks into fMP4 and feeds them into a
// MediaSource. The actual upstream-engine reader lives on the server: a
// single same-origin /api/stream/proxy/<cid> connection that the server
// pipes from the engine's playback URL. This sidesteps both the engine's
// "one global active session" rule (the server holds it) and the
// browser's CORS rules (it's same-origin).

let mpegtsPlayer = null;   // the live mpegts.createPlayer instance, or null

// MediaSource + mpegts.js detection lives in ./lib/feature_detect.js
// and is exercised against stub globals in the test suite.
function inBrowserSupported() {
  return inBrowserPlaybackSupported(window);
}

// Post-handoff "you can close this tab" screen.
//
// Originally this tried window.close() too, but the result was
// inconsistent across browsers: Firefox sometimes obeys, Brave /
// Chrome refuse (the spec lets browsers ignore close() on tabs the
// script didn't open). Asking-then-failing felt buggy. We just
// replace the page with a clear "you may close this tab" notice
// instead so the behavior is identical everywhere.
function _closeThisTab(targetLabel) {
  document.body.innerHTML =
    '<div style="text-align:center;padding:3rem;color:#aaa;' +
    'font:14px/1.5 system-ui,sans-serif">' +
    '<h2 style="color:#eee">Sent to ' + targetLabel + '</h2>' +
    '<p>The stream is now playing in ' + targetLabel + '. ' +
    'You may close this tab.</p></div>';
}

function startInBrowserPlayback(cid) {
  // Tear down any prior player. The library doesn't no-op a destroy on a
  // dead instance and a leaked MediaSource will leak the upstream socket.
  stopInBrowserPlayback();

  const v = $('pb-video');
  const status = $('pb-video-status');
  v.style.display = '';
  status.textContent = 'Connecting to engine…';
  status.className = 'gate-hint';

  // Cache-buster query so the browser never serves a stale-cached body
  // for the proxy URL (we send no-store but belt + braces).
  const url = '/api/stream/proxy/' + cid + '?t=' + Date.now() + buildGpuParams();
  // Pre-roll buffer (Player card slider): 0 = off / play at the live
  // edge as before; >0 = hold playback back by that many seconds for a
  // hiccup cushion. Read once, at play time.
  const bufferSecs = getPlaybackBuffer();
  // Tracks whether we're still filling the pre-roll buffer, so the
  // MEDIA_INFO handler doesn't stomp the "Buffering N/M s…" read-out
  // with "Playing — …" before the cushion is built.
  let buffering = bufferSecs > 0;
  let mediaInfoText = '';
  let speedMbps = null;
  // Encode path label shown in the status line — computed once at play
  // time from the GPU settings so it reflects what was actually sent.
  const encodeLabel = gpuEncodeLabel();
  let currentFps = null;
  let _lastFrames = null;
  let _lastFrameTime = null;
  const playerCfg = {
    type: 'mpegts', isLive: true, url,
    // When the MSE SourceBuffer fills up (browser memory ceiling),
    // automatically evict the oldest buffered data instead of stalling.
    // Without this, large buffer values (e.g. 300 s) hit the limit and
    // suspend the transmuxing task — "SourceBuffer is full".
    autoCleanupSourceBuffer: true,
    // Keep at most bufferSecs of backward history; evict anything older.
    // This lets mpegts.js reclaim space before the browser hard-caps it.
    autoCleanupMaxBackwardDuration: Math.max(bufferSecs, 60),
    autoCleanupMinBackwardDuration: Math.max(bufferSecs - 10, 30),
  };
  if (bufferSecs > 0) {
    // Stop mpegts.js seeking to the live edge — that chasing would
    // erase the very cushion the slider asks us to hold.
    playerCfg.liveBufferLatencyChasing = false;
  }
  try {
    mpegtsPlayer = window.mpegts.createPlayer(playerCfg);
  } catch (e) {
    status.textContent = 'mpegts.js init failed: ' + e.message;
    status.className = 'gate-hint warn';
    return;
  }

  // Native HTMLMediaElement error — fires BEFORE the mpegts.js ERROR
  // event when MSE rejects something. Tells us exactly why MSE bailed:
  //   code 1 ABORTED, 2 NETWORK, 3 DECODE (most likely for codec issues),
  //   4 SRC_NOT_SUPPORTED (format outright unsupported).
  v.onerror = () => {
    const e = v.error;
    if (e) console.warn('[video] error code=' + e.code + ' message="' + e.message + '"');
  };

  if (window.mpegts.Events) {
    const E = window.mpegts.Events;
    mpegtsPlayer.on(E.MEDIA_INFO, (info) => {
      const codec = (info && (info.videoCodec || info.mimeType)) || 'video';
      const audio = (info && info.audioCodec) ? ' / ' + info.audioCodec : '';
      mediaInfoText = 'Playing — ' + codec + audio;
      // renderStatus keeps the codec/format text and appends the live
      // buffer figure; it no-ops while the pre-roll counter is up.
      renderStatus();
    });
    mpegtsPlayer.on(E.STATISTICS_INFO, (stats) => {
      if (!stats) return;
      if (stats.speed != null)
        speedMbps = stats.speed * 8 / 1024;  // KB/s → Mbps
      if (stats.decodedFrames != null) {
        const now = performance.now();
        if (_lastFrames !== null && _lastFrameTime !== null) {
          const dt = (now - _lastFrameTime) / 1000;
          if (dt > 0) currentFps = (stats.decodedFrames - _lastFrames) / dt;
        }
        _lastFrames = stats.decodedFrames;
        _lastFrameTime = now;
      }
    });
    mpegtsPlayer.on(E.ERROR, (type, detail) => {
      // Freeze the line on the error — stop the health ticker from
      // overwriting it with the next "· buffer" refresh.
      _stopBufferHealth();
      console.warn('[mpegts]', type, detail);
      status.textContent = 'Stream error: ' + type
          + (detail && detail.code ? ' (code ' + detail.code + ')' : '');
      status.className = 'gate-hint warn';
    });
  }

  v.addEventListener('waiting',  _armStall);
  v.addEventListener('stalled',  _armStall);
  v.addEventListener('playing',  _clearStall);
  v.addEventListener('canplay',  _clearStall);

  mpegtsPlayer.attachMediaElement(v);
  mpegtsPlayer.load();
  // play() returns a promise; if the user hasn't interacted with the
  // page yet, autoplay-without-mute will reject — surface that to them.
  const startPlay = () => {
    if (!mpegtsPlayer) return;
    mpegtsPlayer.play().catch(e => {
      status.textContent =
        'Click the video to start (browser blocked autoplay): ' + e.message;
      status.className = 'gate-hint warn';
    });
  };
  // Live status line during playback: the codec/format from MEDIA_INFO
  // PLUS how many seconds are buffered ahead of the playhead, side by
  // side. The buffer figure is the runway — watch it drain toward 0 if
  // the engine stalls or slows before the video actually stutters.
  const renderStatus = () => {
    if (buffering) return;            // pre-roll counter owns the line until release
    const base = mediaInfoText || 'Playing';
    const ahead = bufferedAhead(v.buffered, v.currentTime);
    const mbps = speedMbps != null ? ' · ' + speedMbps.toFixed(1) + ' Mbps' : '';
    const fps  = currentFps != null ? ' · ' + Math.round(currentFps) + ' fps' : '';
    const res  = v.videoWidth  ? ' · ' + v.videoWidth + '×' + v.videoHeight : '';
    status.textContent = base + ' · buffer ' + ahead.toFixed(1) + ' s' + mbps + fps + res + ' · ' + encodeLabel;
    status.className = 'gate-hint';
  };
  const beginPlayback = () => {
    startPlay();
    _startBufferHealth(renderStatus);
  };
  if (!buffering) {
    beginPlayback();
    return;
  }
  // Strip the native controls while the cushion fills — otherwise the
  // user can hit the controls' Play and start at the live edge with an
  // empty buffer, defeating the pre-roll. Restored on release.
  v.controls = false;
  // Hold playback until the pre-roll cushion is full, then release.
  _preRollBuffer(v, status, bufferSecs, () => {
    buffering = false;
    v.controls = true;
    beginPlayback();
  });
}

// Once-a-second ticker that refreshes the buffered-ahead figure in the
// status line during playback. Module-level so Stop / a fresh Play /
// a stream error can clear it (otherwise it'd keep painting over them).
let _bufferHealthTimer = null;

// Stall watchdog: if the video enters "waiting" for 8 s without recovering
// (ffmpeg died, proxy dropped), show an error instead of spinning forever.
let _stallTimer = null;
function _clearStall() {
  if (!_stallTimer) return;
  clearTimeout(_stallTimer);
  _stallTimer = null;
}
function _armStall() {
  if (_stallTimer) return;
  _stallTimer = setTimeout(() => {
    _stallTimer = null;
    _stopBufferHealth();
    const s = $('pb-video-status');
    if (s) { s.textContent = 'Stream stalled — proxy disconnected or stream ended'; s.className = 'gate-hint warn'; }
  }, 8000);
}

function _stopBufferHealth() {
  if (!_bufferHealthTimer) return;
  clearInterval(_bufferHealthTimer);
  _bufferHealthTimer = null;
}

function _startBufferHealth(render) {
  _stopBufferHealth();
  render();                          // paint immediately, don't wait 1 s
  _bufferHealthTimer = setInterval(render, 1000);
}

// Pending pre-roll timers, so a Stop / fresh Play can cancel an
// in-flight buffer wait instead of leaking a 0–75 s setTimeout closure.
let _preRollHandle = null;

function _cancelPreRoll() {
  if (!_preRollHandle) return;
  clearInterval(_preRollHandle.timer);
  clearTimeout(_preRollHandle.cap);
  _preRollHandle = null;
}

// Keep the in-tab player paused until `target` seconds are buffered
// ahead of the playhead, then run `onRelease` (which calls play()).
// Polls the <video>'s buffered ranges every 250 ms; a safety cap
// releases anyway on slow / low-bitrate streams so we never strand the
// user on a frozen first frame.
function _preRollBuffer(v, status, target, onRelease) {
  _cancelPreRoll();
  let done = false;
  const release = () => {
    if (done) return;
    done = true;
    _cancelPreRoll();
    onRelease();
  };
  const tick = () => {
    if (!mpegtsPlayer) { _cancelPreRoll(); return; }
    const have = Math.floor(bufferedAhead(v.buffered, v.currentTime));
    status.textContent = 'Buffering ' + Math.min(have, target) + '/' + target + ' s…';
    status.className = 'gate-hint';
    if (bufferReady(v.buffered, v.currentTime, target)) release();
  };
  const timer = setInterval(tick, 250);
  const cap = setTimeout(release, (target + 15) * 1000);
  _preRollHandle = { timer, cap };
  tick();
}

function getPlaybackBuffer() {
  const el = $('playback-buffer');
  if (el) return clampBuffer(el.value, 60);
  return clampBuffer(localStorage.getItem(KEYS.PLAYBACK_BUFFER), 60);
}

function stopInBrowserPlayback() {
  const v = $('pb-video');
  const status = $('pb-video-status');
  // Drop any in-flight pre-roll wait and the buffer-health ticker
  // before tearing the player down.
  _cancelPreRoll();
  _stopBufferHealth();
  _clearStall();
  if (mpegtsPlayer) {
    try { mpegtsPlayer.pause(); } catch (_) {}
    try { mpegtsPlayer.unload(); } catch (_) {}
    try { mpegtsPlayer.detachMediaElement(); } catch (_) {}
    try { mpegtsPlayer.destroy(); } catch (_) {}
    mpegtsPlayer = null;
  }
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.style.display = 'none';
    // Restore controls in case we stopped mid pre-roll (where they were
    // stripped) — the next play starts from a clean default.
    v.controls = true;
  }
  if (status) { status.textContent = ''; status.className = 'gate-hint'; }
  // Nothing is playing in this tab anymore — pull the Move button.
  if (livePlaybackTarget === 'browser') {
    livePlaybackTarget = '';
    if (typeof refreshPlaybackMoveButton === 'function') refreshPlaybackMoveButton();
  }
}

// Updates the channel-name line above the playback URL. Empty primary
// hides the row entirely so a cid-typed-by-hand session doesn't get a
// misleading placeholder.
// Reflect the playing channel in the tab title so a row of tabs still
// tells you which is which. Falls back to plain "Aceman" when nothing's
// playing or when the channel has no display name (raw cid play).
export function setTabTitle(name) {
  const base = 'Aceman';
  document.title = name ? `${base} - ${name}` : base;
}

export function setNowPlayingName(primary, sub) {
  const el = $('playback-title');
  el.textContent = '';
  if (!primary) {
    // Card title falls back to the same string the empty-state HTML
    // uses — "Watch". Anything else here desyncs the title from the
    // input's placeholder ("Channel name, acestream://...") and
    // leaves the operator wondering whether a stale stream is still
    // referenced somewhere.
    el.textContent = 'Watch';
    return;
  }
  el.appendChild(document.createTextNode(primary));
  if (sub && sub !== primary) {
    const s = document.createElement('span');
    s.className = 'sub';
    s.textContent = sub;
    el.appendChild(s);
  }
}

// play() optionally takes context about *where* the Play came from so the
// now-playing card can show the channel name. If no name is passed (e.g.
// the user typed a cid directly), we try to look it up in the favourites
// list — typing a cid you've saved should still show its name.
//
// opts.skipConfirm=true suppresses the "Open in Brave and close this tab"
// confirm modal on the open-in-other-browser path. Used by the
// acestream:// pending-play pickup: the user already configured the
// target browser AND clicked the link — both are the same "I want to
// watch this" signal, asking again would be noise. Manual Play-button
// clicks keep the confirm.
export async function play(opts = {}) {
  showError('');
  const cid = parseId($('cid-input').value);
  if (!cid) { showError('Enter a 40-hex content id or an acestream:// URI.'); return; }

  // Resolve a display name: caller-provided name wins; missing
  // primary falls back to a favourite lookup so a raw cid typed
  // into the input still gets its proper saved label. See
  // ./lib/display_name.js.
  const { name: displayName, sub: displaySub } =
      resolveDisplayName(opts, allFavs, cid);
  current = { cid, name: displayName, altName: displaySub };
  setTabTitle(displayName);
  // Persist the live cid + display name so a page reload can rehydrate
  // the input + now-playing card. We only restore on load when the
  // broker confirms the wrapper is actually alive — see
  // refreshEngineStatus — so a stale key from a long-dead session
  // never repopulates the UI.
  saveLastPlay(localStorage, { cid, name: displayName, sub: displaySub });
  setNowPlayingName(displayName, displaySub);
  $('now-playing').style.display = 'block';
  updateSaveButton();
  refreshPlaybackMoveButton();

  // Stamp last_played so the "watched N days ago" badge updates without a
  // refresh. Browser-mode is local; sqlite-mode goes through the server.
  // Best-effort — Play must not fail on a bookkeeping write.
  if (mode === 'browser') {
    browserFavs.touchCid(cid);
  } else {
    api('/api/favs/touch', {
      method: 'POST', body: JSON.stringify({ cid }),
    }).catch(() => {});
    if (displayName) {
      api('/api/history', {
        method: 'POST', body: JSON.stringify({ cid, name: displayName }),
      }).catch(() => {});
    }
  }
  loadFavs();

  // Pure decision — see ./lib/playback_decision.js for the matrix
  // (playback_mode × default_browser × inBrowserSupported). Every
  // side effect below is gated by `path.kind`.
  const path = decidePlaybackPath(cfg, {
    inBrowserSupported: inBrowserSupported(),
  });

  // Stop any host-side player before starting in-browser paths.
  // open-in-other-browser is excluded — it shows a confirm modal
  // first and kills the player only after the user says yes, so
  // cancelling the confirm doesn't leave the user with a dead VLC
  // and no stream. external-scheme does its own teardown inside its case.
  if (path.kind === 'in-tab' || path.kind === 'in-tab-unsupported-fallback') {
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
  }

  switch (path.kind) {
    case 'open-in-other-browser': {
      // Specific-browser target → open a new window there with
      // ?play=<cid>; its own JS picks up the cid and starts
      // in-page playback. We don't open anything in *this* tab.
      //
      // Skip the confirm modal when the caller already has implicit
      // consent (acestream://-link pickup): the user configured the
      // target browser AND clicked the link. Asking again would
      // make every link click two clicks.
      if (!opts.skipConfirm && !(await showConfirm({
          title: `Open in ${path.label}`,
          message: `Open the stream in ${path.label} and close this tab? `
                 + `A new window will open in ${path.label}. This tab will then `
                 + `close automatically so you don't end up with two players running.`,
          confirmText: 'Open & close',
      }))) {
        return;
      }
      // User confirmed — now safe to stop any external player (VLC/mpv).
      try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
      catch (_) { /* best-effort */ }
      stopInBrowserPlayback();   // free this tab so we don't double-stream
      try {
        await api('/api/open-in-browser', {
          method: 'POST', body: JSON.stringify({ cid }),
        });
        livePlaybackTarget = _currentTargetValue();
      } catch (e) {
        showError('Could not open browser: ' + e.message);
        refreshPlaybackMoveButton();
        return;
      }
      _closeThisTab(path.label);
      return;
    }

    case 'in-tab-unsupported-fallback': {
      showError(path.warning);
      livePlaybackTarget = path.target;
      window.location.href = 'acestream://' + cid;
      return;
    }

    case 'in-tab': {
      // Order matters: startInBrowserPlayback calls
      // stopInBrowserPlayback first to tear down any prior player,
      // and that helper clears livePlaybackTarget when it sees it
      // set to 'browser'. So we set the live target AFTER the start
      // call — otherwise we'd immediately blow away the value and
      // the Move button would think nothing is playing.
      startInBrowserPlayback(cid);
      livePlaybackTarget = 'browser';
      refreshPlaybackMoveButton();
      return;
    }

    case 'external-scheme': {
      // External player. Tear down BOTH possible previous players:
      //   (a) an in-browser proxy in this tab, and
      //   (b) any host-side VLC/mpv held by an earlier wrapper.
      if (mpegtsPlayer) stopInBrowserPlayback();
      try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
      catch (_) { /* best-effort */ }
      livePlaybackTarget = path.target;
      refreshPlaybackMoveButton();
      // The desktop entry installed for this app claims
      // x-scheme-handler/acestream and routes the URL to the host
      // aceman shell. The page stays put — browsers don't navigate
      // when the target scheme has a handler.
      window.location.href = 'acestream://' + cid;
      return;
    }
  }
}

// Unified "Play in" dropdown: in-browser tab + every detected browser
// + every detected external player are one flat list. Three classes
// of target, one decision:
//   "browser"               — this tab (in-page mpegts.js player)
//   "browser|name|source"   — open a new window in a specific browser
//                             which then auto-plays in its own tab
//   "external|name|source"  — VLC/mpv via the acestream:// scheme
function _currentTargetValue() {
  if (cfg.playback_mode === 'browser') {
    return encodeTarget('browser', cfg.default_browser, cfg.default_browser_source);
  }
  return encodeTarget('external', cfg.default_player, cfg.default_player_source);
}

function _addOptgroup(sel, label) {
  const g = document.createElement('optgroup');
  g.label = label;
  sel.appendChild(g);
  return g;
}

export function renderPlaybackTargets() {
  const sel = $('playback-target');
  const hint = $('player-hint');
  if (!sel) return;
  sel.innerHTML = '';
  hint.textContent = ''; hint.className = 'gate-hint';

  const showAll = $('show-all-browsers') && $('show-all-browsers').checked;
  const view = buildPlaybackOptions({
    detectedPlayers,
    detectedBrowsers,
    currentBrowser: _currentBrowserName,
    showAll,
    inBrowserSupported: inBrowserSupported(),
  });

  // Apply the group tree to the <select>. Top-level options (label
  // === null) attach directly; everything else gets an <optgroup>.
  for (const group of view.groups) {
    const parent = group.label ? _addOptgroup(sel, group.label) : sel;
    for (const o of group.options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      opt.disabled = o.disabled;
      parent.appendChild(opt);
    }
  }

  if (!view.hasAnyTarget) {
    sel.disabled = true;
    hint.textContent = view.hintMessage;
    hint.className = 'gate-hint warn';
    return;
  }
  sel.disabled = false;

  // In WSL mode the Player card is hidden — but we still need a sane
  // default selection for the Play button to use. Every detected
  // external player / browser belongs to the Linux side and isn't
  // reachable from the Windows browser viewing this page; the only
  // target that actually works is the in-tab mpegts.js stream. Force
  // it here and persist, so a stale `default_player: vlc` left over
  // from a previous non-WSL session doesn't silently break Play.
  const wanted = isWslMode ? 'browser' : _currentTargetValue();
  const wantedAvailable = wanted
      && Array.from(sel.options).some(o => o.value === wanted);
  if (wantedAvailable) {
    sel.value = wanted;
  } else if (sel.options.length) {
    sel.value = sel.options[0].value;
    persistPlaybackTarget(sel.value, /*silent=*/true);
  }
  // Independent of the path above: if we're in WSL and the persisted
  // config still names a Linux-side target, rewrite it to 'browser'
  // so the next /api/config read agrees with what we just selected.
  const wslConfigDrift = isWslMode
      && wantedAvailable
      && cfg && cfg.playback_mode !== 'browser';
  if (wslConfigDrift) {
    persistPlaybackTarget('browser', /*silent=*/true);
  }
  refreshPlaybackMoveButton();
}

// Stores the dropdown selection as config; no live-stream handoff
// here. `silent` suppresses the showError on save failure (used by
// the auto-fallback in renderPlaybackTargets).
export async function persistPlaybackTarget(value, silent) {
  const payload = targetValueToConfig(value);
  try {
    cfg = await api('/api/config', {
      method: 'POST', body: JSON.stringify(payload),
    });
  } catch (e) {
    if (!silent) showError(e.message);
  }
  refreshPlaybackMoveButton();
}

// Shows the "Move current stream here" button only when a stream is
// playing AND the dropdown's selection differs from where it's
// currently playing. Self-rebuilt on every render/save so the user
// never sees the button suggest a no-op.
// Swap the Play button between ▶ (idle) and ⏹ (something playing).
// The button keeps its primary blue style in both states; only the
// glyph + tooltip change. Anything that mutates livePlaybackTarget
// should call this (refreshPlaybackMoveButton is the canonical
// recompute point and already does).
// Blocking "please wait" overlay used during play/stop transitions
// where multiple awaits can run for a few hundred ms (broker call to
// kill the wrapper, in-tab proxy teardown, etc.). Without this users
// click again mid-flight and double-fire the whole sequence — leading
// to the very races we just spent days fixing. The modal-backdrop
// already covers the viewport and intercepts pointer events on
// everything below it.
// Block the UI behind the busy modal until the engine reports both
// container + HTTP API up, or until `timeoutMs` elapses. Caller can
// await this to sequence work after the engine is ready.
export async function waitForEngineReady(msg, timeoutMs = 90_000) {
  // Eager pre-check: ask the broker about the engine + image state
  // BEFORE showing the modal. If the image is uninstalled, the modal
  // never paints — we go straight to the actionable error. Saves the
  // ~600 ms minVisibleMs flash and avoids the poll-loop timing race
  // where the modal would paint, then dismiss the next tick.
  //
  // Failures here (BrokerError, connection refused, etc.) fall through
  // to the polling-loop path below, which is the right thing for a
  // transient blip: the loop will retry every 4 s via the standing
  // refreshEngineStatus interval and dismiss on first healthy read.
  try {
    const s = await api('/api/engine/status');
    engineState.applyPoll(s);
    // Image-missing bail: silently. The play-button gate hint
    // (`install the engine image in Setup & tools first`) already
    // paints next to the Play button from describePlayButton — adding
    // a second `showError` line above the play card was a duplicate.
    if (s && s.image_installed === false) return false;
    if (engineState.isHealthy()) return true;
  } catch (_) { /* fall through to the polling loop */ }

  showBusy(msg || 'Please wait while Aceman is getting ready…');
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  // Minimum visible duration so the modal actually paints — without it
  // a same-tick stale "engine up" snapshot would resolve before the
  // browser ever draws the backdrop.
  const minVisibleMs = 600;
  try {
    while (Date.now() < deadline) {
      if (engineState.isReadyToDismissSince(startedAt, minVisibleMs)) {
        return true;
      }
      // Same image-missing short-circuit (silent), for the case where
      // the eager pre-check above failed (BrokerError) and a later
      // poll comes through with image_installed=false. The
      // play-button gate hint already surfaces the actionable text.
      const s = engineState.last;
      const haveFreshRead = engineState.isFreshSince(startedAt);
      const minHeld = (Date.now() - startedAt) >= minVisibleMs;
      if (haveFreshRead && minHeld && s && s.image_installed === false) {
        return false;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  } finally { hideBusy(); }
}

// Cold-start gate. Launched from the desktop entry, the browser opens
// (and the static page paints) a beat before the web backend is
// accepting connections — the wrapper may still be (re)creating the
// --rm web container. The first /api/* fetch then rejects with a bare
// NetworkError (no .status) and the user lands on a live-looking page
// behind a "Could not contact backend" line. Hold behind the busy
// modal and retry until the server answers.
//
// Retries ONLY on connection-level failures. An error carrying a
// .status means the server DID respond (some real HTTP error) — that's
// not a "still booting" case, so we surface it rather than spin.
// Returns true once reachable, false if the deadline passes first.
export async function waitForBackend(msg, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let shown = false;
  try {
    for (;;) {
      try {
        await api('/api/storage-mode');
        return true;
      } catch (e) {
        if (e && e.status !== undefined) throw e;   // reachable, real error
        if (Date.now() >= deadline) return false;
        if (!shown) {
          showBusy(msg || 'Please wait while Aceman is getting ready…');
          shown = true;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } finally {
    if (shown) hideBusy();
  }
}

function refreshPlayButton() {
  const btn = $('play-btn');
  if (!btn) return;
  const v = describePlayButton(!!livePlaybackTarget);
  btn.textContent = v.text;
  btn.title = v.title;
  btn.setAttribute('aria-label', v.ariaLabel);
  btn.classList.toggle('playing', v.playingClass);
  const rbtn = $('restream-btn');
  // Show the restart (↺) button whenever anything is live — browser OR
  // external. restartStream() handles both: for external it stops the
  // host player and re-fires acestream://, which relaunches VLC/mpv with
  // the current buffer_secs. Restart is how a changed buffer/GPU setting
  // takes effect.
  if (rbtn) rbtn.style.display = livePlaybackTarget ? '' : 'none';
  // Nothing live → no stream to restart, so retire the reminder.
  if (!livePlaybackTarget) dismissNotice('restart-needed');
}

export async function restartStream() {
  if (!current) return;
  const cid = current.cid;
  dismissNotice('restart-needed');   // restarting resolves the reminder
  showBusy('Restarting…');
  try {
    stopInBrowserPlayback();
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
    $('cid-input').value = cid;
    await play({ name: current.name });
  } finally {
    hideBusy();
  }
}

function refreshPlaybackMoveButton() {
  const btn = $('playback-move');
  const sel = $('playback-target');
  // "Live" pip on the PLAYBACK card label reuses the same authoritative
  // "is anything actually playing right now" flag the move button does.
  const livePip = $('playback-live');
  if (livePip) livePip.style.display = livePlaybackTarget ? '' : 'none';
  refreshPlayButton();
  // Canonical recompute point for live state. Refresh the search
  // section visibility (depends on input value) AND the ✕ clear
  // button (depends on input value too) from here so anything that
  // changes cid-input programmatically — play(), play-on-load,
  // search-row click — gets these updated even if no `input` event
  // fired.
  refreshSearchSection();
  refreshClearButton();
  if (!btn || !sel) return;
  const selectedLabel = sel.selectedIndex >= 0
      ? sel.options[sel.selectedIndex].textContent
      : '';
  const view = describeMoveButton(livePlaybackTarget, sel.value, selectedLabel);
  btn.style.display = view.visible ? '' : 'none';
  if (view.visible) btn.textContent = view.text;
  requestAnimationFrame(refreshPlayerRowAlignment);
}

// Align #playback-move and #show-all-row when they wrap to a new flex row.
//
// Move button: indent to 5.5rem (left-aligns under the dropdown trigger).
// Show all: center horizontally under the Move button. When Move is hidden,
// fall back to centering under the dropdown trigger itself.
// When either item is on the same row as the label it gets no forced indent
// (move) or auto-push-right (show-all) instead.
export function refreshPlayerRowAlignment() {
  const field = $('player-select-row');
  if (!field) return;
  const label = field.querySelector('.field-label');
  if (!label) return;
  const labelBottom = label.getBoundingClientRect().bottom;

  const moveBtn = $('playback-move');
  const moveBtnVisible = moveBtn && moveBtn.offsetParent !== null;
  const moveBtnWrapped = moveBtnVisible &&
    moveBtn.getBoundingClientRect().top > labelBottom - 4;

  if (moveBtnVisible) {
    moveBtn.style.marginLeft = moveBtnWrapped ? '5.5rem' : '';
  }

  const showAll = $('show-all-row');
  if (!showAll) return;
  const showAllWrapped = showAll.getBoundingClientRect().top > labelBottom - 4;
  if (!showAllWrapped) { showAll.style.marginLeft = 'auto'; return; }

  // Center show-all under the reference element (Move button when visible,
  // otherwise the dropdown trigger). Move button's left edge is already
  // known to be 5.5rem when wrapped, so compute its centre without a reflow.
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const showAllWidth = showAll.offsetWidth;

  if (moveBtnWrapped) {
    const moveCenter = 5.5 * remPx + moveBtn.offsetWidth / 2;
    showAll.style.marginLeft = Math.max(0, moveCenter - showAllWidth / 2) + 'px';
  } else {
    const trigger = field.querySelector('.aceman-select-trigger');
    if (trigger) {
      const fieldLeft = field.getBoundingClientRect().left;
      const tr = trigger.getBoundingClientRect();
      const trigCenter = tr.left - fieldLeft + tr.width / 2;
      showAll.style.marginLeft = Math.max(0, trigCenter - showAllWidth / 2) + 'px';
    } else {
      showAll.style.marginLeft = '5.5rem';
    }
  }
}

export async function movePlaybackToSelection() {
  if (!current) return;
  const value = $('playback-target').value;

  // Pre-compute what path the new target will take so we can ask
  // for confirmation BEFORE showing any busy overlay or touching
  // the current player — cancelling must leave VLC/mpv untouched.
  const prospectivePath = decidePlaybackPath(
    targetValueToConfig(value), { inBrowserSupported: inBrowserSupported() });

  // Always confirm before moving a live stream — all paths kill the
  // current player and the user may have clicked by accident.
  // open-in-other-browser gets a specific warning because the tab
  // closes; all other paths get a generic "move to X?" prompt.
  const sel = $('playback-target');
  const destLabel = sel.options[sel.selectedIndex]
    ? sel.options[sel.selectedIndex].textContent.trim()
    : 'selected player';

  const confirmOpts = prospectivePath.kind === 'open-in-other-browser'
    ? {
        title: `Open in ${prospectivePath.label}`,
        message: `Open the stream in ${prospectivePath.label} and close this tab? `
               + `A new window will open in ${prospectivePath.label}. This tab will then `
               + `close automatically so you don't end up with two players running.`,
        confirmText: 'Open & close',
      }
    : {
        title: 'Move stream',
        message: `Move the current stream to ${destLabel}?`,
        confirmText: 'Move',
      };

  if (!(await showConfirm(confirmOpts))) return;

  // User confirmed. Now safe to stop the current player.
  showBusy('Switching player…');
  try {
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
    stopInBrowserPlayback();
    await persistPlaybackTarget(value, /*silent=*/false);
    $('cid-input').value = current.cid;
    await play({ name: current.name, skipConfirm: true });
    refreshPlaybackMoveButton();
  } finally {
    hideBusy();
  }
}

// ---- engine status + controls ------------------------------------------
let pendingEngineAction = false; // suppress polling label flicker while a button is mid-action

// Settling-window state machine — see ./lib/engine_state.js. The
// transitions (running→down, held-enough exit, healthy clear) are
// pure logic that lives in the module and is unit-tested under
// web/js_tests/engine_state.test.mjs. This file owns only the
// poll / hydrate / render wiring around it.
export const engineState = new EngineStatusState();

// First-to-claim acestream:// handoff. The wrapper's fast-path POSTs
// the cid to /api/play-request when a second invocation fires; every
// open tab sees s.pending_play_cid on the next status poll. POST the
// claim — server atomically clears the slot, only the first POST
// returns claimed:true. Multiple tabs each call play() at most once
// because the server is the synchronisation point.
async function maybePickUpPendingPlay(s) {
  const cid = (s && typeof s.pending_play_cid === 'string')
              ? s.pending_play_cid : '';
  if (!/^[a-f0-9]{40}$/.test(cid)) return;
  // Already live with this cid? Don't bounce playback.
  if (current && current.cid === cid) return;
  let claim;
  try {
    claim = await api('/api/play-request/claim', {
      method: 'POST', body: JSON.stringify({ cid }),
    });
  } catch (_) { return; }
  if (!claim || claim.claimed !== true) return;
  // We own this handoff. Fill the Watch input and play through the
  // same code path a fav-click uses — resolveDisplayName picks up the
  // name from favourites if it's saved. skipConfirm so a configured
  // "play in Brave" target doesn't prompt the user mid-link-click.
  $('cid-input').value = cid;
  refreshClearButton();
  refreshSearchSection();
  try { await play({ skipConfirm: true }); }
  catch (_) { /* surfaced via showError */ }
}

export async function refreshEngineStatus() {
  if (pendingEngineAction) return;
  let s;
  try {
    s = await api('/api/engine/status');
  } catch (_) {
    return;  // leave previous state on the UI
  }
  engineState.applyPoll(s);
  // Fire-and-forget — pending-play handling shouldn't block the rest
  // of the status refresh. The claim POST has its own short timeout.
  maybePickUpPendingPlay(s);
  // External player went away (user closed VLC window, mpv crashed,
  // wrapper exited normally) — clear the live pip so it stops
  // blinking when nothing is actually playing.
  if (isExternal(livePlaybackTarget) && s.wrapper_alive === false) {
    livePlaybackTarget = '';
    refreshPlaybackMoveButton();
  }
  // External player IS alive but the page just loaded / reloaded so
  // we lost the in-memory livePlaybackTarget. Recover it from the
  // saved player preference so the Play button immediately shows the
  // stop glyph (▶ → ⏹) without waiting for the user to act. Same go
  // for the cid + display name:
  //   1. server-provided wrapper_cid wins (covers the
  //      acestream://-link flow where the web never played anything
  //      itself — localStorage is empty there, but the shell wrapper
  //      writes its cid to a runtime file the broker surfaces)
  //   2. fall back to the localStorage stash (covers the in-tab Play
  //      then reload flow)
  // Name is resolved from favourites whenever we only have a cid —
  // typing/clicking a saved cid should still show its name.
  if (!livePlaybackTarget && s.wrapper_alive === true
      && cfg.playback_mode === 'external' && cfg.default_player) {
    livePlaybackTarget = encodeTarget('external', cfg.default_player, cfg.default_player_source);
    const last = loadLastPlay(localStorage);
    const cid = (s.wrapper_cid && /^[a-f0-9]{40}$/.test(s.wrapper_cid))
                ? s.wrapper_cid
                : (last && last.cid) || '';
    if (cid) {
      // If we got the cid from the wrapper we don't have a name —
      // resolveDisplayName takes care of the favourites lookup
      // (same call play() uses) so an already-saved channel surfaces
      // its name automatically.
      const fromLast = last && last.cid === cid ? last : null;
      const { name: displayName, sub: displaySub } =
          resolveDisplayName(fromLast || {}, allFavs, cid);
      current = { cid, name: displayName, altName: displaySub };
      setTabTitle(displayName);
      $('cid-input').value = cid;
      setNowPlayingName(displayName, displaySub);
      $('now-playing').style.display = 'block';
      updateSaveButton();
    }
    refreshPlaybackMoveButton();
  }
  // Wrapper is definitely gone — drop the stash so a future reload
  // doesn't repopulate the input from a stale session. BUT only when
  // we're actually in external-player mode: in-browser playback has
  // no host-side wrapper by design (wrapper_alive is permanently
  // false), so an unconditional clear here would wipe the cid every
  // poll cycle and the in-browser refresh-rehydrate path would never
  // see anything in localStorage.
  if (s.wrapper_alive === false
      && cfg.playback_mode === 'external'
      && !mpegtsPlayer) {
    clearLastPlay(localStorage);
  }
  const el = $('engine-status');
  const btn = $('engine-toggle');
  const hint = $('engine-toggle-hint');

  const view = describeEngineToggle(s, engineState.isSettling());
  el.textContent = view.status;
  el.className = view.statusClass;
  btn.textContent = view.button.text;
  btn.dataset.action = view.button.action;
  btn.className = view.button.className;
  btn.disabled = view.button.disabled;
  hint.textContent = view.hint.text;
  hint.className = view.hint.className;

  refreshPlayGate();
}

// Gates the Play button on the latest engine status. Separated from the
// poll so other code paths (e.g. just-started engine) can re-evaluate
// immediately without waiting for the next tick.
function refreshPlayGate() {
  const view = describePlayButtonGate(engineState.last);
  const btn = $('play-btn');
  const hint = $('play-hint');
  btn.disabled = view.disabled;
  hint.textContent = view.hint.text;
  hint.className = view.hint.className;
  requestAnimationFrame(alignSearchToInput);
}

export async function toggleEngine() {
  const btn = $('engine-toggle');
  const action = btn.dataset.action || 'start';
  pendingEngineAction = true;
  btn.disabled = true;
  btn.textContent = action === 'start' ? 'Starting…' : 'Stopping…';
  showError('');
  try {
    await api('/api/engine/' + action, { method: 'POST' });
  } catch (e) {
    showError(e.message);
  } finally {
    pendingEngineAction = false;
    refreshEngineStatus();
  }
}

export async function saveAutostart() {
  const checked = $('autostart').checked;
  try {
    const next = await api('/api/config', {
      method: 'POST', body: JSON.stringify({ engine_autostart: checked }),
    });
    cfg = next;
  } catch (e) {
    showError(e.message);
    $('autostart').checked = !checked; // revert UI on failure
  }
}

