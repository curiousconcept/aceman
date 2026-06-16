// app.js is loaded as an ES module from index.html. Pure helpers live
// under ./lib/ and are unit-tested under web/js_tests/. Everything in
// THIS file is the wiring between the DOM, the broker, and those
// helpers — there's nothing here a JS test should be poking at
// directly. Add new pure logic to a lib module first.
import { parseId } from './lib/cid.js';
import { uniqueFavName } from './lib/favnames.js';
import { createBrowserFavs } from './lib/browser_favs.js';
import { daysSinceLabel } from './lib/format.js';
import { EngineStatusState } from './lib/engine_state.js';
import { createApi } from './lib/api.js';
import { encodeTarget, isExternal } from './lib/playback_target.js';
import { KEYS, migrateLegacy } from './lib/storage_keys.js';
import { runModal } from './lib/modal.js';
import { debounce } from './lib/debounce.js';
import { paginate } from './lib/pagination.js';
import { shouldSearch, normaliseQuery, buildSearchUrl } from './lib/search_query.js';
import { saveLastPlay, loadLastPlay, clearLastPlay } from './lib/last_play.js';
import { browserLabel, detectCurrentBrowser as detectCurrentBrowserPure }
  from './lib/browsers.js';
import { extractPlayCid } from './lib/page_query.js';
import { inBrowserSupported as inBrowserSupportedPure } from './lib/feature_detect.js';
import { extractExistingName } from './lib/api_errors.js';
import { describeImageStatus } from './lib/image_status.js';
import { buildPlaybackOptions } from './lib/playback_options.js';
import { decidePlaybackPath } from './lib/playback_decision.js';
import { findFavByCid } from './lib/fav_lookup.js';
import { targetValueToConfig } from './lib/playback_config.js';
import { formatResetReport } from './lib/factory_reset_report.js';

const $ = id => document.getElementById(id);

// One-shot migration of localStorage keys from the project's old
// `acewatch.*` namespace to the current `aceman.*`. See
// ./lib/storage_keys.js — idempotent, unit-tested.
migrateLegacy(localStorage);
let mode = 'browser';   // 'sqlite' or 'browser', set by /api/storage-mode
// Tracks just enough about the last Play to drive the Save button: we no
// longer own the session (the host shell does via acestream:// dispatch),
// so there's no playback_url or command_url to remember.
let current = null;     // { cid, name }
// Where the active stream is actually playing, as a dropdown-value
// string ('browser' | 'external|name|source' | ''). Set when play()
// fires, NOT when the dropdown changes — the dropdown is the user's
// pending intent, this is reality. The "Move current stream here"
// button compares the two; if they match, there's nothing to move.
let livePlaybackTarget = '';

function showError(msg) {
  const el = $('err');
  el.textContent = msg || '';
}

// JSON fetch wrapper — see ./lib/api.js. Tests inject a fake fetch
// via createApi(fakeFetch); the production singleton uses globalThis.fetch.
const api = createApi();

// Browser-side favourites store (used when the server has no sqlite3).
// Implementation lives in ./lib/browser_favs.js and is unit-tested.
const browserFavs = createBrowserFavs();

// In-memory cached list + filter/page state. allFavs is the full set from
// whichever store; the renderer slices it by search and page.
let allFavs = [];
let favSearch = '';
let favPage = 0;
const FAV_PAGE_SIZE = 10;

async function loadFavs() {
  allFavs = (mode === 'sqlite') ? await api('/api/favs') : browserFavs.list();
  renderFavs();
  // Favourites set might have changed (saved/renamed/deleted in another
  // tab), so re-evaluate the Save-as-favourite button vs. star indicator.
  updateSaveButton();
  // Re-render any visible search results so a delete/rename here flips
  // their per-row "★ Saved as …" state back to "★ Save" (or vice versa).
  if (allSearchResults.length) renderSearchResults();
}

function filteredFavs() {
  const q = favSearch.trim().toLowerCase();
  return q ? allFavs.filter(f => f.name.toLowerCase().includes(q)) : allFavs;
}

function renderFavs() {
  const filtered = filteredFavs();
  const p = paginate(filtered.length, favPage, FAV_PAGE_SIZE);
  favPage = p.page;

  const list = $('fav-list');
  list.innerHTML = '';
  for (const f of p.slice(filtered)) list.appendChild(renderFavRow(f));

  $('fav-empty').style.display = allFavs.length === 0 ? 'block' : 'none';
  $('fav-pager').style.display = filtered.length > FAV_PAGE_SIZE ? '' : 'none';
  $('fav-prev').disabled = !p.hasPrev;
  $('fav-next').disabled = !p.hasNext;
  $('fav-info').textContent = p.isEmpty
    ? (allFavs.length ? 'no matches' : '')
    : p.label();
}

function renderFavRow(f) {
  const row = document.createElement('div');
  row.className = 'fav';

  const wrap = document.createElement('div');
  wrap.className = 'fav-name-wrap';

  const name = document.createElement('span');
  name.className = 'fav-name';
  name.textContent = f.name;
  name.title = `${f.cid}\nDouble-click to rename`;
  name.ondblclick = () => startEditName(f, name);

  const last = document.createElement('span');
  last.className = 'fav-last';
  last.textContent = daysSinceLabel(f.last_played);

  wrap.appendChild(name);
  wrap.appendChild(last);

  const playBtn = document.createElement('button');
  // U+25B6 BLACK RIGHT-POINTING TRIANGLE — universal "play" glyph,
  // unicode-only so we don't have to ship an SVG / icon font.
  playBtn.textContent = '▶';
  playBtn.title = 'Play';
  playBtn.setAttribute('aria-label', 'Play');
  playBtn.classList.add('icon-btn');
  playBtn.onclick = async () => {
    $('cid-input').value = f.cid;
    showBusy('Starting…');
    try { await play({ name: f.name }); } finally { hideBusy(); }
  };

  const delBtn = document.createElement('button');
  // U+1F5D1 WASTEBASKET — universal "delete" glyph, unicode-only.
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete';
  delBtn.setAttribute('aria-label', 'Delete');
  delBtn.classList.add('icon-btn');
  delBtn.onclick = () => deleteFav(f.name);

  row.appendChild(wrap);
  row.appendChild(playBtn);
  row.appendChild(delBtn);
  return row;
}

// Replace the name span with an <input>, commit on Enter/blur, cancel on Esc.
function startEditName(f, span) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fav-edit-input';
  input.value = f.name;
  span.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    if (input.parentNode) input.replaceWith(span);
  };
  const commit = async () => {
    if (done) return;
    const newName = input.value.trim();
    if (!newName || newName === f.name) { restore(); return; }
    done = true;
    try {
      await renameFav(f.name, newName);
    } catch (e) {
      done = false; showError(e.message); restore();
    }
  };
  input.onblur = commit;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
  };
}

async function renameFav(oldName, newName) {
  if (mode === 'sqlite') {
    await api('/api/favs/' + encodeURIComponent(oldName), {
      method: 'PATCH', body: JSON.stringify({ name: newName }),
    });
  } else {
    browserFavs.rename(oldName, newName);
  }
  await loadFavs();
}

async function deleteFav(name) {
  if (!confirm(`Delete favourite "${name}"?`)) return;
  if (mode === 'sqlite') {
    await api('/api/favs/' + encodeURIComponent(name), { method: 'DELETE' });
  } else {
    browserFavs.delete(name);
  }
  loadFavs();
}

// ---- search (search-ace.stream via /api/search) ------------------------
let lastSearchQuery = '';
// Pagination of search results. Mirrors the favourites pager — same
// 5-per-page convention applied to the upstream's MAX_RESULTS=50 cap.
let allSearchResults = [];
let searchPage = 0;
const SEARCH_PAGE_SIZE = 5;

// 300ms trailing-edge debounce so live typing doesn't hammer the upstream.
const onSearchInput = debounce(() => runSearch(), 300);

async function runSearch() {
  const q = normaliseQuery($('search-input').value);
  lastSearchQuery = q;
  $('search-results').innerHTML = '';
  $('search-status').textContent = '';
  console.debug('[search] query', { len: q.length, query: q });
  if (!shouldSearch(q)) {
    console.debug('[search] skipped (too short)');
    return;
  }
  $('search-status').textContent = 'searching…';
  const t0 = performance.now();
  try {
    const data = await api(buildSearchUrl(q));
    if (q !== lastSearchQuery) {
      console.debug('[search] stale response, dropped', q);
      return;
    }
    const results = data.results || [];
    console.debug('[search] got', results.length, 'results in',
      Math.round(performance.now() - t0), 'ms');
    allSearchResults = results;
    searchPage = 0;
    renderSearchResults();
    $('search-status').textContent = results.length
      ? `${results.length} result${results.length === 1 ? '' : 's'}`
      : 'no matches';
  } catch (e) {
    if (q !== lastSearchQuery) return;
    console.warn('[search] failed:', e.message);
    $('search-status').textContent = '';
    showError('search failed: ' + e.message);
  }
}

function renderSearchResults() {
  const list = $('search-results');
  list.innerHTML = '';
  const p = paginate(allSearchResults.length, searchPage, SEARCH_PAGE_SIZE);
  searchPage = p.page;
  for (const r of p.slice(allSearchResults)) list.appendChild(renderSearchRow(r));
  const pager = $('search-pager');
  if (pager) {
    pager.style.display = allSearchResults.length > SEARCH_PAGE_SIZE ? '' : 'none';
    $('search-prev').disabled = !p.hasPrev;
    $('search-next').disabled = !p.hasNext;
    $('search-info').textContent = p.label();
  }
}

function renderSearchRow(r) {
  const row = document.createElement('div');
  row.className = 'fav';

  const wrap = document.createElement('div');
  wrap.className = 'fav-name-wrap';

  // Pick the more useful label as primary. Keep the alternate as a sub-line
  // so Latin users see the English name with the Cyrillic original below
  // (or vice versa).
  const primary = (r.translated_name || r.name).trim();
  const altRaw = (r.translated_name && r.name && r.translated_name !== r.name)
    ? r.name : '';

  const name = document.createElement('span');
  name.className = 'fav-name';
  name.textContent = primary;
  name.title = r.cid;

  const sub = document.createElement('span');
  sub.className = 'fav-last';
  sub.textContent = altRaw || (r.cid.slice(0, 8) + '…');

  wrap.appendChild(name);
  wrap.appendChild(sub);

  const playBtn = document.createElement('button');
  playBtn.textContent = '▶';
  playBtn.title = 'Play';
  playBtn.setAttribute('aria-label', 'Play');
  playBtn.classList.add('icon-btn');
  playBtn.onclick = async () => {
    $('cid-input').value = r.cid;
    showBusy('Starting…');
    try { await play({ name: primary, altName: altRaw }); } finally { hideBusy(); }
  };

  const saveBtn = document.createElement('button');
  // If this cid is already saved, render the button in its "saved" state
  // from the start — disabled, with the existing favourite name surfaced
  // if it doesn't match what we'd have called it. Saves a click + alert
  // round-trip and tells the user where to look in their favourites list.
  const existing = findFavByCid(allFavs, r.cid);
  saveBtn.classList.add('icon-btn');
  if (existing) {
    markSearchRowSaved(saveBtn, existing.name, primary);
  } else {
    saveBtn.textContent = '★';
    saveBtn.title = 'Add to favourites (pick a name: English, Original, or custom)';
    saveBtn.setAttribute('aria-label', 'Add to favourites');
    saveBtn.onclick = () => instaSave(r, saveBtn, primary);
  }

  row.appendChild(wrap);
  row.appendChild(playBtn);
  row.appendChild(saveBtn);
  return row;
}

// Flip a search-row's save button into the "already in favourites" state.
// Keeps the same single-glyph footprint as the Save state (avoids
// shifting siblings) and surfaces the favourite name only as a tooltip.
function markSearchRowSaved(btn, favName, rowPrimary) {
  btn.disabled = true;
  btn.classList.add('icon-btn', 'has-tooltip');
  btn.textContent = '★';
  btn.title = favName;
  btn.setAttribute('aria-label', btn.title);
  btn.onclick = null;
}

// Names of every saved favourite — used by uniqueFavName when seeding
// a candidate label so the suggestion doesn't collide.
const takenFavNames = () => allFavs.map(f => f.name);

async function instaSave(r, btn, rowPrimary) {
  const originalText = btn.textContent;
  // Cheap client-side check first — covers the common case without a
  // roundtrip. The server still re-checks (race-safe + authoritative).
  // Normally the button would already be in its "saved" state in this
  // case (set by renderSearchRow), but the cache could be stale if
  // another tab raced us.
  const existing = findFavByCid(allFavs, r.cid);
  if (existing) {
    markSearchRowSaved(btn, existing.name, rowPrimary);
    return;
  }
  const taken = takenFavNames();
  const english = uniqueFavName(r.translated_name, taken);
  const originalLabel = uniqueFavName(r.name, taken);
  const name = await showFavNameModal(english || '', originalLabel || '');
  if (!name) return;
  btn.disabled = true;
  try {
    if (mode === 'sqlite') {
      await api('/api/favs', {
        method: 'POST', body: JSON.stringify({ name, cid: r.cid }),
      });
    } else {
      browserFavs.add(name, r.cid);
    }
    await loadFavs();
    // Persistent "saved" state — no revert. Mirrors the same row state
    // the user gets if they re-search and see the result again later.
    markSearchRowSaved(btn, name, rowPrimary);
  } catch (e) {
    const existingName = extractExistingName(e);
    if (existingName) {
      // A race (another tab added it between our load and our POST) —
      // flip into the saved state instead of bouncing to the user.
      markSearchRowSaved(btn, existingName, rowPrimary);
    } else {
      showError(e.message);
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// ---- playback ----------------------------------------------------------
let cfg = {};

function clearNowPlaying() {
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
  return inBrowserSupportedPure(window);
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
  const url = '/api/stream/proxy/' + cid + '?t=' + Date.now();
  try {
    mpegtsPlayer = window.mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url,
    });
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
      status.textContent = 'Playing — ' + codec + audio;
      status.className = 'gate-hint';
    });
    mpegtsPlayer.on(E.ERROR, (type, detail) => {
      console.warn('[mpegts]', type, detail);
      status.textContent = 'Stream error: ' + type
          + (detail && detail.code ? ' (code ' + detail.code + ')' : '');
      status.className = 'gate-hint warn';
    });
  }

  mpegtsPlayer.attachMediaElement(v);
  mpegtsPlayer.load();
  // play() returns a promise; if the user hasn't interacted with the
  // page yet, autoplay-without-mute will reject — surface that to them.
  mpegtsPlayer.play().catch(e => {
    status.textContent =
      'Click the video to start (browser blocked autoplay): ' + e.message;
    status.className = 'gate-hint warn';
  });
}

function stopInBrowserPlayback() {
  const v = $('pb-video');
  const status = $('pb-video-status');
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
  }
  if (status) { status.textContent = ''; status.className = 'gate-hint'; }
  // Nothing is playing in this tab anymore — pull the Move button.
  if (livePlaybackTarget === 'browser') {
    livePlaybackTarget = '';
    if (typeof refreshPlaybackMoveButton === 'function') refreshPlaybackMoveButton();
  }
}

// Toggles between "Save as favourite" (call to action) and the read-only
// star indicator when this cid is already in favourites.
function updateSaveButton() {
  const btn = $('save-btn');
  if (!btn) return;
  // Hide entirely when there's no candidate cid to save — keeps the
  // top row tight (just ▶ + content-id input) before the user starts
  // anything. Shows up next to the input the moment a stream is
  // playing, with flex-wrap letting it drop to the next line if the
  // row is too narrow.
  if (!current) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = '';
  const fav = findFavByCid(allFavs, current.cid);
  if (fav) {
    btn.textContent = `★ Saved as "${fav.name}"`;
    btn.disabled = true;
    btn.title = 'Already in your favourites — open the Favourites column to manage.';
  } else {
    btn.textContent = 'Save as favourite';
    btn.disabled = false;
    btn.title = '';
  }
}

// Updates the channel-name line above the playback URL. Empty primary
// hides the row entirely so a cid-typed-by-hand session doesn't get a
// misleading placeholder.
// Reflect the playing channel in the tab title so a row of tabs still
// tells you which is which. Falls back to plain "Aceman" when nothing's
// playing or when the channel has no display name (raw cid play).
function setTabTitle(name) {
  const base = 'Aceman';
  document.title = name ? `${base} - ${name}` : base;
}

function setNowPlayingName(primary, sub) {
  const el = $('playback-title');
  el.textContent = '';
  if (!primary) {
    el.textContent = 'Playback';
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
async function play(opts = {}) {
  showError('');
  const cid = parseId($('cid-input').value);
  if (!cid) { showError('Enter a 40-hex content id or an acestream:// URI.'); return; }

  // Resolve a display name: argument first, then favourite lookup so a
  // raw cid still gets its proper label when it's a saved channel.
  let displayName = (opts.name || '').trim();
  let displaySub = (opts.altName || '').trim();
  if (!displayName) {
    const fav = findFavByCid(allFavs, cid);
    if (fav) displayName = fav.name;
  }
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
  }
  loadFavs();

  // Pure decision — see ./lib/playback_decision.js for the matrix
  // (playback_mode × default_browser × inBrowserSupported). Every
  // side effect below is gated by `path.kind`.
  const path = decidePlaybackPath(cfg, {
    inBrowserSupported: inBrowserSupported(),
  });

  // Browser-mode paths share a player-stop preflight so we never
  // race a previous wrapper. External mode does its own teardown
  // below since it tears down BOTH the in-page player AND the
  // host wrapper before dispatching the scheme handler.
  if (path.kind !== 'external-scheme') {
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
  }

  switch (path.kind) {
    case 'open-in-other-browser': {
      // Specific-browser target → open a new window there with
      // ?play=<cid>; its own JS picks up the cid and starts
      // in-page playback. We don't open anything in *this* tab.
      if (!confirm(
          `Open the stream in ${path.label} and close this tab?\n\n` +
          `A new window will open in ${path.label}. This tab will then ` +
          `close automatically so you don't end up with two players ` +
          `running.`)) {
        return;
      }
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

function renderPlaybackTargets() {
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

  const wanted = _currentTargetValue();
  if (wanted && Array.from(sel.options).some(o => o.value === wanted)) {
    sel.value = wanted;
  } else if (sel.options.length) {
    sel.value = sel.options[0].value;
    persistPlaybackTarget(sel.value, /*silent=*/true);
  }
  refreshPlaybackMoveButton();
}

// Stores the dropdown selection as config; no live-stream handoff
// here. `silent` suppresses the showError on save failure (used by
// the auto-fallback in renderPlaybackTargets).
async function persistPlaybackTarget(value, silent) {
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
function showBusy(msg) {
  const m = $('busy-modal'); if (!m) return;
  const t = $('busy-modal-msg'); if (t) t.textContent = msg || 'Working…';
  m.style.display = 'flex';
}
function hideBusy() {
  const m = $('busy-modal'); if (m) m.style.display = 'none';
}

// Block the UI behind the busy modal until the engine reports both
// container + HTTP API up, or until `timeoutMs` elapses. Caller can
// await this to sequence work after the engine is ready.
async function waitForEngineReady(msg, timeoutMs = 90_000) {
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
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  } finally { hideBusy(); }
}

function refreshPlayButton() {
  const btn = $('play-btn');
  if (!btn) return;
  if (livePlaybackTarget) {
    btn.textContent = '⏹';
    btn.title = 'Stop';
    btn.setAttribute('aria-label', 'Stop');
    btn.classList.add('playing');
  } else {
    btn.textContent = '▶';
    btn.title = 'Play';
    btn.setAttribute('aria-label', 'Play');
    btn.classList.remove('playing');
  }
}

function refreshPlaybackMoveButton() {
  const btn = $('playback-move');
  const sel = $('playback-target');
  // "Live" pip on the PLAYBACK corner label reuses the same authoritative
  // "is anything actually playing right now" flag the move button does.
  const livePip = $('playback-live');
  if (livePip) livePip.style.display = livePlaybackTarget ? '' : 'none';
  refreshPlayButton();
  if (!btn || !sel) return;
  // Nothing actually playing (no in-browser proxy, no external launch
  // we know about) → hide. `livePlaybackTarget` is set by play()/move
  // when a stream actually starts, and cleared by stopInBrowserPlayback
  // / clearNowPlaying. Without this, hitting "Stop in-browser playback"
  // left the Move button visible because `current` was still set.
  if (!livePlaybackTarget) { btn.style.display = 'none'; return; }
  if (sel.value && sel.value !== livePlaybackTarget) {
    btn.style.display = '';
    btn.textContent = `Move current stream → ${sel.options[sel.selectedIndex].textContent}`;
  } else {
    btn.style.display = 'none';
  }
}

async function movePlaybackToSelection() {
  if (!current) return;
  const value = $('playback-target').value;
  // Always release the previous player/proxy first — engine is
  // single-active and a dangling player would race the new one.
  stopInBrowserPlayback();
  try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
  catch (_) { /* best-effort */ }
  // Persist the new target before launching so config + live state
  // match. If the user already moved the dropdown, this is a no-op
  // on the server.
  await persistPlaybackTarget(value, /*silent=*/false);
  // Re-run the unified play path so all three target classes go
  // through the same dispatch (this tab / other browser / external).
  $('cid-input').value = current.cid;
  await play({ name: current.name });
  refreshPlaybackMoveButton();
}

async function saveFav() {
  if (!current) return;
  // Skip the name prompt if this cid is already saved — the user is much
  // more likely re-clicking the button by accident than wanting a second
  // entry under a new name.
  const existing = findFavByCid(allFavs, current.cid);
  if (existing) {
    alert(`This stream is already in your favourites as “${existing.name}”.`);
    return;
  }
  // When the stream came from a search result, the row carries TWO
  // candidate labels — the translated/English one (current.name) and
  // the original (often Cyrillic) sub-label (current.altName). Offer
  // both as one-click buttons plus a custom text option.
  const english = (current.name || '').trim();
  const original = (current.altName || '').trim();
  const name = await showFavNameModal(english, original);
  if (!name) return;
  try {
    if (mode === 'sqlite') {
      await api('/api/favs', {
        method: 'POST', body: JSON.stringify({ name, cid: current.cid }),
      });
    } else {
      browserFavs.add(name, current.cid);
    }
  } catch (e) {
    // Server / store had a stale-cache duplicate the pre-check missed
    // (e.g. another tab added it between loads).
    const existingName = extractExistingName(e);
    if (existingName) {
      alert(`This stream is already in your favourites as “${existingName}”.`);
    } else {
      showError(e.message);
    }
    return;
  }
  loadFavs();
}

// ---- engine status + controls ------------------------------------------
let pendingEngineAction = false; // suppress polling label flicker while a button is mid-action

// Settling-window state machine — see ./lib/engine_state.js. The
// transitions (running→down, held-enough exit, healthy clear) are
// pure logic that lives in the module and is unit-tested under
// web/js_tests/engine_state.test.mjs. This file owns only the
// poll / hydrate / render wiring around it.
const engineState = new EngineStatusState();

async function refreshEngineStatus() {
  if (pendingEngineAction) return;
  let s;
  try {
    s = await api('/api/engine/status');
  } catch (_) {
    return;  // leave previous state on the UI
  }
  engineState.applyPoll(s);
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
  // for the cid + display name — stashed in localStorage on play()
  // and re-hydrated here so a reload doesn't lose what's playing.
  if (!livePlaybackTarget && s.wrapper_alive === true
      && cfg.playback_mode === 'external' && cfg.default_player) {
    livePlaybackTarget = encodeTarget('external', cfg.default_player, cfg.default_player_source);
    const last = loadLastPlay(localStorage);
    if (last) {
      current = { cid: last.cid, name: last.name };
      setTabTitle(last.name);
      $('cid-input').value = last.cid;
      setNowPlayingName(last.name, last.sub);
      $('now-playing').style.display = 'block';
      updateSaveButton();
    }
    refreshPlaybackMoveButton();
  }
  // Wrapper is definitely gone — drop the stash so a future reload
  // doesn't repopulate the input from a stale session.
  if (s.wrapper_alive === false) clearLastPlay(localStorage);
  const el = $('engine-status');
  const btn = $('engine-toggle');
  const hint = $('engine-toggle-hint');
  hint.textContent = '';
  hint.className = 'gate-hint';

  const settling = engineState.isSettling();

  if (s.container && s.up) {
    el.textContent = 'running';
    el.className = 'status ok';
    btn.textContent = 'Stop';
    btn.dataset.action = 'stop';
    btn.className = 'danger-outline';
    btn.disabled = false;
  } else if (settling) {
    // Any partial state during the settle window — container up but
    // API still not answering, or container fully gone — gets the
    // same disabled "Settling…" treatment. The status text varies so
    // the user can see *what* phase of restart we're in.
    el.textContent = s.container
        ? 'restarting… (container up, API not answering)'
        : 'restarting…';
    el.className = 'status';
    btn.textContent = 'Settling…';
    btn.dataset.action = '';
    btn.className = '';
    btn.disabled = true;
  } else if (s.container) {
    el.textContent = 'container up, API not answering';
    el.className = 'status bad';
    btn.textContent = 'Stop';
    btn.dataset.action = 'stop';
    btn.className = 'danger-outline';
    btn.disabled = false;
  } else {
    el.textContent = 'not running';
    el.className = 'status bad';
    btn.textContent = 'Start';
    btn.dataset.action = 'start';
    btn.className = 'primary';
    if (s.image_installed === false) {
      btn.disabled = true;
      hint.textContent = 'engine image not installed';
      hint.className = 'gate-hint warn';
    } else {
      btn.disabled = false;
    }
  }

  refreshPlayGate();
}

// Gates the Play button on the latest engine status. Separated from the
// poll so other code paths (e.g. just-started engine) can re-evaluate
// immediately without waiting for the next tick.
function refreshPlayGate() {
  const s = engineState.last;
  const btn = $('play-btn');
  const hint = $('play-hint');
  // Same rule as refreshEngineStatus: require both flags so a phantom
  // s.up (port answered, container reports down) doesn't enable Play
  // and let the user start a session against something we don't manage.
  if (s && s.container && s.up) {
    btn.disabled = false;
    hint.textContent = '';
    hint.className = 'gate-hint';
  } else if (s && s.image_installed === false) {
    btn.disabled = true;
    hint.textContent = 'install the engine image in Setup & tools first';
    hint.className = 'gate-hint warn';
  } else {
    btn.disabled = true;
    hint.textContent = 'engine is not running — start it from the Engine card';
    hint.className = 'gate-hint warn';
  }
}

async function toggleEngine() {
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

async function saveAutostart() {
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

// ---- detection of host-side players + browsers -------------------------
//
// Both feeds come from the broker (host-side allow-list). We never spawn
// players directly — the OS scheme handler routes acestream:// to the
// shell wrapper which reads the same default_player config we write.

let detectedPlayers = [];   // [{name, source}]
let detectedBrowsers = [];  // [{name, source}]

async function loadPlayers() {
  try {
    const r = await api('/api/players');
    detectedPlayers = Array.isArray(r.available) ? r.available : [];
  } catch (_) { detectedPlayers = []; }
  renderPlaybackTargets();
}

async function loadBrowsers() {
  try {
    const r = await api('/api/browsers');
    detectedBrowsers = Array.isArray(r.available) ? r.available : [];
  } catch (_) { detectedBrowsers = []; }
  renderPlaybackTargets();
}

// Display-name mapping + UA detection live in ./lib/browsers.js.
// We keep `_currentBrowserName` as a wired-in slot so the renderer
// can read it synchronously after init resolves.
const _browserLabel = browserLabel;
let _currentBrowserName = '';
async function detectCurrentBrowser() {
  _currentBrowserName = await detectCurrentBrowserPure({
    userAgent: navigator.userAgent || '',
    brave: navigator.brave || null,
  });
}

// (Browsers are rendered as options inside the unified "Play in"
// dropdown by renderPlaybackTargets — no dedicated browser
// dropdown / button anymore.)

// ---- custom dropdown (drop-in replacement for <select>) ----------------
//
// Browsers — especially Firefox on Linux — render the native <select>
// popup using GTK/Qt, ignoring CSS for the option highlight (purple by
// default on most distros). We don't replace the <select>; we keep it
// in the DOM for accessibility + form semantics + the existing JS API
// (.value, .options, .selectedIndex, .onchange / .addEventListener
// 'change'), then overlay this widget driven by it.
//
// mountAcemanSelect(native) idempotently wraps the given <select> with
// a custom trigger + listbox. Rebuilds the listbox whenever the native
// options change (MutationObserver) so renderPlaybackTargets keeps
// being the single source of truth. Programmatic value assignment is
// caught by overriding the value setter on the instance — native
// <select> doesn't fire 'change' on `el.value = ...`, but we still
// need the trigger label to update.
function mountAcemanSelect(native) {
  if (!native || native._acemanMounted) return;
  native._acemanMounted = true;

  const wrap = document.createElement('span');
  wrap.className = 'aceman-select-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'aceman-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'aceman-select-label';
  trigger.appendChild(label);

  const listbox = document.createElement('div');
  listbox.className = 'aceman-select-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.hidden = true;

  native.parentNode.insertBefore(wrap, native);
  wrap.appendChild(trigger);
  wrap.appendChild(listbox);
  wrap.appendChild(native);
  native.classList.add('aceman-select-native');
  native.setAttribute('tabindex', '-1');
  native.setAttribute('aria-hidden', 'true');

  let focusedOption = null;

  function focusOption(o) {
    if (focusedOption) focusedOption.classList.remove('focused');
    if (o) {
      o.classList.add('focused');
      focusedOption = o;
      o.scrollIntoView({ block: 'nearest' });
    } else {
      focusedOption = null;
    }
  }

  function nextOption(from, dir) {
    let n = from;
    while (true) {
      n = dir > 0 ? n.nextElementSibling : n.previousElementSibling;
      if (!n) return null;
      if (n.classList.contains('aceman-select-option')
          && n.getAttribute('aria-disabled') !== 'true') return n;
    }
  }

  function firstOption() {
    return listbox.querySelector('.aceman-select-option:not([aria-disabled="true"])');
  }

  function buildOption(opt) {
    const o = document.createElement('div');
    o.className = 'aceman-select-option';
    o.setAttribute('role', 'option');
    o.dataset.value = opt.value;
    o.textContent = opt.textContent;
    if (opt.disabled) o.setAttribute('aria-disabled', 'true');
    if (opt.value === native.value) o.setAttribute('aria-selected', 'true');
    o.addEventListener('mousedown', (e) => {
      // mousedown not click — so the outside-click handler (also on
      // mousedown) doesn't fire first and close the listbox before
      // our click reaches us.
      e.preventDefault();
      if (opt.disabled) return;
      if (native.value !== opt.value) {
        native.value = opt.value;
        native.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
      trigger.focus();
    });
    o.addEventListener('mouseenter', () => focusOption(o));
    return o;
  }

  function rebuildOptions() {
    listbox.innerHTML = '';
    for (const node of native.children) {
      if (node.tagName === 'OPTGROUP') {
        const g = document.createElement('div');
        g.className = 'aceman-select-group';
        g.textContent = node.label;
        listbox.appendChild(g);
        for (const opt of node.children) listbox.appendChild(buildOption(opt));
      } else if (node.tagName === 'OPTION') {
        listbox.appendChild(buildOption(node));
      }
    }
    updateTriggerLabel();
    syncDisabled();
  }

  function updateTriggerLabel() {
    const sel = native.options[native.selectedIndex];
    label.textContent = sel ? sel.textContent : '';
    for (const o of listbox.querySelectorAll('.aceman-select-option')) {
      if (o.dataset.value === native.value) o.setAttribute('aria-selected', 'true');
      else o.removeAttribute('aria-selected');
    }
  }

  function syncDisabled() {
    trigger.disabled = native.disabled;
    if (native.disabled && !listbox.hidden) close();
  }

  function open() {
    if (native.disabled) return;
    listbox.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const sel = listbox.querySelector('[aria-selected="true"]:not([aria-disabled="true"])');
    focusOption(sel || firstOption());
    document.addEventListener('mousedown', onOutside, true);
  }
  function close() {
    listbox.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
    focusOption(null);
  }
  function onOutside(e) { if (!wrap.contains(e.target)) close(); }

  trigger.addEventListener('click', () => {
    if (listbox.hidden) open(); else close();
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (listbox.hidden) open();
      else {
        const next = focusedOption ? nextOption(focusedOption, e.key === 'ArrowDown' ? 1 : -1) : firstOption();
        if (next) focusOption(next);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (listbox.hidden) open();
      else if (focusedOption) {
        focusedOption.dispatchEvent(new MouseEvent('mousedown'));
      }
    } else if (e.key === 'Escape') {
      if (!listbox.hidden) { e.preventDefault(); close(); }
    } else if (e.key === 'Tab') {
      close();   // let focus move on naturally
    }
  });

  // Mirror programmatic native.value = "..." into the trigger label
  // (the native <select> does NOT fire 'change' for programmatic
  // assignment, but our renderer does set sel.value to seed selection).
  const proto = Object.getPrototypeOf(native);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.configurable !== false) {
    Object.defineProperty(native, 'value', {
      get: desc.get,
      set(v) { desc.set.call(this, v); updateTriggerLabel(); },
      configurable: true,
    });
  }

  // Native options can be rebuilt by renderPlaybackTargets at any
  // time (e.g. when loadBrowsers resolves after loadPlayers); reflect
  // those changes into our listbox.
  const obs = new MutationObserver(rebuildOptions);
  obs.observe(native, { childList: true, subtree: true,
                        attributes: true,
                        attributeFilter: ['disabled', 'selected'] });

  rebuildOptions();
}

// ---- engine image management -------------------------------------------
let imagePoll = null;

async function refreshImageStatus() {
  let s = null;
  try { s = await api('/api/engine/image'); }
  catch (_) { /* leave s = null; describeImageStatus collapses to 'unavailable' */ }

  const view = describeImageStatus(s);

  // Top-line status badge + registry tag (the tag is broker-supplied
  // and only present in a successful fetch).
  $('image-status').textContent = view.status;
  $('image-status').className = view.statusClass;
  if (s) {
    $('image-tag').textContent = s.tag || '';
    if (s.tag) $('image-label').title = s.tag;
  }

  const ins = $('image-install');
  const un = $('image-uninstall');
  ins.textContent = view.installButton.text;
  ins.disabled = view.installButton.disabled;
  un.disabled = !view.uninstallEnabled;

  // Build log (auto-scrolled to the bottom so new lines are visible).
  const log = $('image-log');
  log.textContent = view.log.lines.join('\n');
  log.scrollTop = log.scrollHeight;
  const logWrap = $('image-log-wrap');
  if (logWrap) {
    logWrap.style.display = view.log.visible ? '' : 'none';
    logWrap.open = view.log.expanded;
  }

  // Error hint — only revealed when describeImageStatus surfaced one.
  const hint = $('image-hint');
  if (view.errorHint) {
    hint.textContent = view.errorHint;
    hint.className = 'status bad';
    hint.style.display = '';
  } else {
    hint.textContent = '';
    hint.className = 'status';
    hint.style.display = 'none';
  }

  // Continue / stop the 1s poll while a build is in flight.
  if (view.pollAgain) {
    if (!imagePoll) imagePoll = setInterval(refreshImageStatus, 1000);
  } else if (imagePoll) {
    clearInterval(imagePoll); imagePoll = null;
  }

  // After every image-state change, refresh the engine status so the
  // Start-engine button's enabled-ness stays in sync.
  refreshEngineStatus();
}

async function installImage() {
  try {
    await api('/api/engine/image', { method: 'POST' });
  } catch (e) {
    showError('image install: ' + e.message);
  }
  refreshImageStatus();
}

async function uninstallImage() {
  if (!confirm('Remove the engine container image? Any running container is stopped first.')) return;
  try {
    const r = await api('/api/engine/image', { method: 'DELETE' });
    if (r.removed === false) showError('image uninstall: ' + (r.error || 'failed'));
  } catch (e) {
    showError('image uninstall: ' + e.message);
  }
  refreshImageStatus();
}

// ---- factory reset -----------------------------------------------------
function openResetModal() {
  $('reset-modal').style.display = 'flex';
  $('reset-confirm-input').value = '';
  $('reset-go').disabled = true;
  $('reset-report').style.display = 'none';
  $('reset-report').textContent = '';
  setTimeout(() => $('reset-confirm-input').focus(), 0);
}
function closeResetModal() { $('reset-modal').style.display = 'none'; }

async function runFactoryReset() {
  const btn = $('reset-go');
  btn.disabled = true;
  btn.textContent = 'Wiping…';
  let report;
  try {
    report = await api('/api/factory-reset', {
      method: 'POST', body: JSON.stringify({ confirm: 'RESET' }),
    });
  } catch (e) {
    showError('factory reset: ' + e.message);
    btn.textContent = 'Wipe everything';
    return;
  }
  // Render the per-step report inside the modal so the user sees what
  // happened. The page itself is now in an inconsistent state (its db is
  // gone, its container is gone) — a hard reload after the user dismisses
  // the modal is the cleanest way back to a known-good state.
  $('reset-report').textContent = formatResetReport(report);
  $('reset-report').style.display = '';
  btn.textContent = 'Done — reload page';
  btn.disabled = false;
  btn.onclick = () => window.location.reload();
}

async function refreshDesktopEntry() {
  let s;
  try {
    s = await api('/api/desktop-entry/app');
  } catch (e) {
    $('desktop-status').textContent = 'unavailable';
    $('desktop-status').className = 'status bad';
    $('desktop-toggle').disabled = true;
    return;
  }
  const btn = $('desktop-toggle');
  btn.disabled = false;
  $('desktop-path').textContent = s.path;
  if (s.path) $('desktop-label').title = s.path;
  if (s.installed) {
    $('desktop-status').textContent = 'installed';
    $('desktop-status').className = 'status ok';
    btn.textContent = 'Uninstall';
    btn.dataset.action = 'uninstall';
    btn.className = 'danger-outline';
  } else {
    $('desktop-status').textContent = 'not installed';
    $('desktop-status').className = 'status';
    btn.textContent = 'Install';
    btn.dataset.action = 'install';
    btn.className = 'primary';
  }
}

// Returns one of: 'with-scheme', 'only', null (cancel). Uses a tiny
// in-page modal because native confirm() can't render three choices.
function showInstallModal() {
  return runModal({ overlay: $('install-modal') }, done => {
    $('install-with-scheme').onclick = () => done('with-scheme');
    $('install-only').onclick = () => done('only');
    $('install-cancel').onclick = () => done(null);
    $('install-with-scheme').focus();
    return () => {
      $('install-with-scheme').onclick = null;
      $('install-only').onclick = null;
      $('install-cancel').onclick = null;
    };
  });
}

// Three-way picker for favourite name: English label, original label,
// or a custom string the user types. Returns the chosen non-empty
// string, or null if cancelled. Selection is staged via radios — the
// favourite is only saved when the user clicks Save.
function showFavNameModal(english, original) {
  const overlay = $('favname-modal');
  const engOpt = $('favname-english-opt');
  const origOpt = $('favname-original-opt');
  const engText = $('favname-english-text');
  const origText = $('favname-original-text');
  const input = $('favname-custom-input');
  const bSave = $('favname-save');
  const bCancel = $('favname-cancel');

  const hasEng = !!english;
  const hasOrig = !!original && original !== english;
  engText.textContent = english || '';
  origText.textContent = original || '';
  engOpt.style.display = hasEng ? '' : 'none';
  origOpt.style.display = hasOrig ? '' : 'none';
  input.value = english || original || '';

  const radios = () => Array.from(
    overlay.querySelectorAll('input[name="favname-choice"]'));
  // Pre-select the first visible labelled option; if neither is
  // available, leave radios unchecked and the input is the implicit
  // (and only) choice.
  const defaultRadio = radios().find(r =>
    (r.value === 'english' && hasEng) ||
    (r.value === 'original' && hasOrig));
  radios().forEach(r => { r.checked = (r === defaultRadio); });

  return runModal({ overlay }, done => {
    const commit = () => {
      const picked = radios().find(r => r.checked);
      let v = '';
      if (picked && picked.value === 'english') v = english;
      else if (picked && picked.value === 'original') v = original;
      else v = (input.value || '').trim(); // implicit custom
      if (!v) { input.focus(); return; }
      done(v);
    };
    const selectCustom = () => {
      // Custom is the absence of a radio selection.
      radios().forEach(r => { r.checked = false; });
    };
    bSave.onclick = commit;
    bCancel.onclick = () => done(null);
    input.onfocus = selectCustom;
    input.oninput = selectCustom;
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    };
    bSave.focus();
    return () => {
      bSave.onclick = bCancel.onclick = null;
      input.onkeydown = input.oninput = input.onfocus = null;
    };
  });
}

async function toggleDesktopEntry() {
  const btn = $('desktop-toggle');
  const action = btn.dataset.action || 'install';

  let registerScheme = false;
  if (action === 'install') {
    const choice = await showInstallModal();
    if (!choice) return;
    registerScheme = choice === 'with-scheme';
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = action === 'install' ? 'Installing…' : 'Removing…';
  let result = null;
  try {
    const opts = { method: action === 'install' ? 'POST' : 'DELETE' };
    if (action === 'install') {
      opts.body = JSON.stringify({ register_scheme: registerScheme });
    }
    result = await api('/api/desktop-entry/app', opts);
  } catch (e) {
    showError('launcher: ' + e.message);
    btn.textContent = original;
    btn.disabled = false;
    return;
  }
  // After a "with-scheme" install, surface what got replaced/backed-up so
  // the user can find their previous handler if they need to restore it.
  if (action === 'install' && registerScheme && result && result.previous_handler) {
    let msg = `Previously, acestream:// was handled by:\n  ${result.previous_handler}\n\n`;
    msg += result.backup
      ? `A backup of mimeapps.list was saved at:\n  ${result.backup}`
      : `(no mimeapps.list found to back up; nothing to restore from.)`;
    alert(msg);
  }
  refreshDesktopEntry();
}

// ---- init --------------------------------------------------------------
(async () => {
  // ACEMAN wordmark glow toggle. Default ON; the ✨ button next to the
  // title flips .glow on the wordmark, and the choice persists across
  // reloads/sessions so the user's pick sticks. Defaulting to on means
  // first-time visitors see the effect that gives the title its
  // identity — they can mute it if it distracts.
  (() => {
    const title = $('aceman-title');
    if (!title) return;
    const stored = localStorage.getItem(KEYS.GLOW);
    title.classList.toggle('glow', stored === null ? true : stored === '1');
    const toggle = () => {
      const next = !title.classList.contains('glow');
      title.classList.toggle('glow', next);
      try { localStorage.setItem(KEYS.GLOW, next ? '1' : '0'); }
      catch (_) {}
    };
    title.onclick = toggle;
    // Keyboard activation since role="button" — Space/Enter to toggle.
    title.onkeydown = e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
    };
  })();

  // Identify what browser we're in BEFORE loadBrowsers triggers the
  // first dropdown render — otherwise the initial render shows the
  // generic "This browser tab" label and doesn't filter same-name
  // entries, then re-renders a beat later when detection resolves.
  await detectCurrentBrowser();
  try {
    const cfg = await api('/api/storage-mode');
    mode = cfg.mode;
    // Engine URL surfaces as a hover tooltip on the Engine corner-label
    // (with the .has-tooltip dashed underline as the visual hint).
    if (cfg.engine) $('engine-label').title = cfg.engine;
    // Search sources, one per line — same hover pattern. The list
    // comes from the server so today we surface search-ace.stream and
    // future additions appear automatically when the backend learns
    // about them. When empty/disabled, drop the dashed underline so
    // the label doesn't claim there's info to hover for.
    const searchLabel = $('search-label');
    if (searchLabel) {
      const srcs = Array.isArray(cfg.search_sources) ? cfg.search_sources : [];
      if (srcs.length) {
        searchLabel.title = srcs.length === 1
            ? `Source: ${srcs[0]}`
            : `Sources:\n  ${srcs.join('\n  ')}`;
      } else {
        searchLabel.classList.remove('has-tooltip');
        searchLabel.title = '';
      }
    }
    $('storage-badge').textContent = mode === 'sqlite' ? 'sqlite' : 'browser';
    // Tooltip surfaces the actual db path when running SQLite-backed —
    // matches the same "label + path on hover" pattern used for Engine
    // image, App launcher, etc.
    $('storage-badge').title = mode === 'sqlite'
      ? (cfg.favorites_path
          ? `SQLite DB: ${cfg.favorites_path}`
          : 'Favourites stored server-side in SQLite.')
      : 'Favourites stored in browser localStorage (server has no sqlite3).';
  } catch (e) {
    showError('Could not contact backend: ' + e.message);
  }

  try {
    cfg = await api('/api/config');
    $('autostart').checked = !!cfg.engine_autostart;
  } catch (_) { /* config endpoint may be disabled */ }

  // Favourites first; engine status second so the page doesn't flash
  // "engine offline" for a tick while loadFavs awaits the DB read.
  await loadFavs();
  await loadPlayers();
  await loadBrowsers();
  // Replace the native <select> popup with our fully-CSS-styled
  // dropdown — Firefox/Linux otherwise renders the option highlight
  // as a system purple no amount of CSS can override.
  mountAcemanSelect($('playback-target'));
  // If we just came back from a Restart, mark the engine settling so
  // the first poll's likely "not running" reading doesn't promote a
  // tempting "Start engine" button while podman is still bouncing.
  // Only honor breadcrumbs younger than 60s so an old key from a
  // crash-reload session doesn't suppress a fresh, intentional stop.
  const _restartedAt = parseInt(sessionStorage.getItem(KEYS.RESTARTED_AT) || '0', 10);
  sessionStorage.removeItem(KEYS.RESTARTED_AT);
  if (_restartedAt && Date.now() - _restartedAt < 60000) {
    engineState.markSettling();
    waitForEngineReady('Please wait while Aceman is getting ready…');
  }
  refreshEngineStatus();
  setInterval(refreshEngineStatus, 4000);

  // The Play button toggles between ▶ (idle) and ⏹ (something playing
   // — anywhere: this tab, another browser, vlc, mpv). Clicking it in
   // the stop state tears down everything: in-browser proxy if any,
   // and any host-side wrapper holding mpv/vlc. The fav touch flow is
   // play()'s responsibility, not stop's.
  $('play-btn').onclick = async () => {
    if (livePlaybackTarget) {
      showBusy('Stopping…');
      try {
        stopInBrowserPlayback();
        try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
        catch (_) { /* best-effort */ }
        livePlaybackTarget = '';
        refreshPlaybackMoveButton();
        refreshPlayButton();
      } finally { hideBusy(); }
    } else {
      showBusy('Starting…');
      try { await play(); } finally { hideBusy(); }
    }
  };
  $('cid-input').addEventListener('keydown', e => { if (e.key === 'Enter') play(); });
  $('save-btn').onclick = saveFav;
  $('engine-toggle').onclick = toggleEngine;
  $('autostart').onchange = saveAutostart;
  $('playback-target').onchange = () => persistPlaybackTarget($('playback-target').value);
  $('playback-move').onclick = async () => {
    showBusy('Switching player…');
    try { await movePlaybackToSelection(); } finally { hideBusy(); }
  };
  // "Show all browser installs" is a UI-only preference (no server
  // round trip) — store it in localStorage so it survives reloads.
  const showAllCb = $('show-all-browsers');
  if (showAllCb) {
    showAllCb.checked = localStorage.getItem(KEYS.SHOW_ALL_BROWSERS) === '1';
    showAllCb.onchange = () => {
      localStorage.setItem(KEYS.SHOW_ALL_BROWSERS, showAllCb.checked ? '1' : '0');
      renderPlaybackTargets();
    };
  }
  // (pb-stop button removed — Play button itself toggles to Stop.)
  $('fav-search').oninput = e => { favSearch = e.target.value; favPage = 0; renderFavs(); };
  $('fav-prev').onclick = () => { favPage--; renderFavs(); };
  $('fav-next').onclick = () => { favPage++; renderFavs(); };
  $('search-input').oninput = onSearchInput;
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });
  $('search-prev').onclick = () => { searchPage--; renderSearchResults(); };
  $('search-next').onclick = () => { searchPage++; renderSearchResults(); };
  $('desktop-toggle').onclick = toggleDesktopEntry;
  refreshDesktopEntry();

  $('image-install').onclick = installImage;
  $('image-uninstall').onclick = uninstallImage;
  refreshImageStatus();

  // Manual "Quit" — sends POST /api/shutdown which stops the engine
  // container and tears down the web server. Explicit user action, so
  // we take "stop everything" at face value: if the host shell happens
  // to be mid-stream, the user is the one who clicked Quit and knows.
  // (The idle-shutdown watcher is the cautious path — it never stops
  // the engine, because the user didn't ask.)
  $('server-shutdown').onclick = async () => {
    if (!confirm('Shut down aceman and stop the engine container?')) return;
    const btn = $('server-shutdown');
    btn.disabled = true;
    btn.textContent = 'Shutting down…';
    try {
      await api('/api/shutdown', {
        method: 'POST', body: JSON.stringify({ stop_engine: true }),
      });
    } catch (_) { /* server may already be gone */ }
    document.body.innerHTML =
      '<div style="text-align:center;padding:3rem;color:#aaa;' +
      'font:14px/1.5 system-ui,sans-serif">' +
      '<h2 style="color:#eee">aceman stopped</h2>' +
      '<p>The engine container has been stopped. You can close this tab.</p>' +
      '</div>';
  };

  // Restart: ask the server to spawn a fresh wrapper with the same
  // argv. The new wrapper hits the port already in use and falls back
  // to the existing port-collision takeover, which POSTs /api/shutdown
  // to *us* with stop_engine=false. So this code just kicks the chain
  // off and replaces the page with a "reconnecting…" notice.
  $('server-restart').onclick = async () => {
    if (!confirm("Restart aceman? (engine container stays running)")) return;
    const btn = $('server-restart');
    btn.disabled = true;
    btn.textContent = 'Restarting…';
    // Breadcrumb the post-reload init will consume to mark the engine
    // as "settling" — otherwise the fresh JS has no transition to
    // detect (engineState.last is empty on cold start) and shows the
    // user a tempting "Start engine" button mid-restart.
    sessionStorage.setItem(KEYS.RESTARTED_AT, String(Date.now()));
    try {
      await api('/api/restart', { method: 'POST', body: '{}' });
    } catch (_) { /* connection close is expected */ }
    document.body.innerHTML =
      '<div style="text-align:center;padding:3rem;color:#aaa;' +
      'font:14px/1.5 system-ui,sans-serif">' +
      '<h2 style="color:#eee">Restarting…</h2>' +
      '<p>Reconnecting in a few seconds.</p></div>';
    // Poll until the new instance responds, then reload.
    const start = Date.now();
    const ping = async () => {
      if (Date.now() - start > 30000) {
        document.body.innerHTML =
          '<div style="text-align:center;padding:3rem;color:#aaa;' +
          'font:14px/1.5 system-ui,sans-serif">' +
          '<h2 style="color:#eee">Restart timed out</h2>' +
          '<p>The new instance didn\'t come up within 30 s. Check ' +
          'the terminal or <code>tools/tail-web.sh</code>.</p></div>';
        return;
      }
      try {
        const r = await fetch('/api/storage-mode', { cache: 'no-store' });
        if (r.ok) { window.location.reload(); return; }
      } catch (_) { /* still down */ }
      setTimeout(ping, 700);
    };
    setTimeout(ping, 1200);  // give old enough time to release the port
  };

  // ---- logs tabs (single viewer, one stream at a time) ------------------
  // Three tabs across the top of the row; clicking one opens the shared
  // viewer below and starts polling that stream. Clicking the active
  // tab again closes the viewer and stops polling. Status indicators on
  // each tab update on every poll regardless of which stream is active
  // (we briefly fetch all three on viewer-open) so the user sees the
  // size of each log even without expanding them — kept lightweight via
  // a single one-shot fetch per tab when the viewer first opens.
  let activeLogsKind = null;
  let logsTimer = null;
  // Paused tabs hold their last-fetched buffer; closing them or
  // switching away resets the flag (a freshly-opened tab always
  // resumes auto-refresh by default).
  let activeLogsPaused = false;
  const logsViewer = $('logs-viewer');
  const logsTabs = Array.from(document.querySelectorAll('.logs-tab'));

  function findTab(kind) { return logsTabs.find(t => t.dataset.kind === kind); }

  function setToggleGlyph(tab, paused) {
    const t = tab && tab.querySelector('[data-role="logs-toggle"]');
    if (!t) return;
    t.textContent = paused ? '▶' : '⏸';
    t.title = paused ? 'Resume auto-refresh' : 'Pause auto-refresh';
  }

  async function updateLogsStatus(kind) {
    const tab = findTab(kind);
    if (!tab) return;
    const status = tab.querySelector('[data-role="logs-status"]');
    try {
      // lines=1 keeps the response small for the per-tab size indicator —
      // we just want size_bytes + available, not the body.
      const r = await api('/api/logs?lines=1&kind=' + encodeURIComponent(kind));
      const kb = (r.size_bytes / 1024).toFixed(1);
      status.textContent = r.available ? `${kb} KB` : '(no log)';
      status.className = 'status';
    } catch (_) {
      status.textContent = '(fetch failed)';
      status.className = 'status bad';
    }
  }

  async function refreshActiveLogs() {
    if (!activeLogsKind) return;
    const tab = findTab(activeLogsKind);
    const status = tab.querySelector('[data-role="logs-status"]');
    try {
      const r = await api('/api/logs?lines=300&kind=' + encodeURIComponent(activeLogsKind));
      const wasAtBottom = logsViewer.scrollHeight - logsViewer.scrollTop
                          - logsViewer.clientHeight < 30;
      logsViewer.textContent = r.tail || '(log is empty — no activity yet)';
      if (wasAtBottom) logsViewer.scrollTop = logsViewer.scrollHeight;
      const kb = (r.size_bytes / 1024).toFixed(1);
      status.textContent = r.available ? `${kb} KB` : '(no log)';
      // Neutral gray (the bare .status color) — size is informational,
      // not a health signal, so the green "ok" tint was misleading.
      status.className = 'status';
    } catch (_) {
      status.textContent = '(fetch failed)';
      status.className = 'status bad';
    }
  }

  function openLogsTab(kind) {
    if (logsTimer) { clearInterval(logsTimer); logsTimer = null; }
    activeLogsKind = kind;
    activeLogsPaused = false;
    for (const t of logsTabs) t.classList.toggle('active', t.dataset.kind === kind);
    setToggleGlyph(findTab(kind), false);
    logsViewer.style.display = '';
    refreshActiveLogs();
    logsTimer = setInterval(refreshActiveLogs, 2500);
    for (const t of logsTabs) {
      if (t.dataset.kind !== kind) updateLogsStatus(t.dataset.kind);
    }
  }

  function closeLogsTabs() {
    if (logsTimer) { clearInterval(logsTimer); logsTimer = null; }
    activeLogsKind = null;
    activeLogsPaused = false;
    for (const t of logsTabs) t.classList.remove('active');
    logsViewer.style.display = 'none';
  }

  function toggleActiveLogsPaused() {
    if (!activeLogsKind) return;
    activeLogsPaused = !activeLogsPaused;
    setToggleGlyph(findTab(activeLogsKind), activeLogsPaused);
    if (activeLogsPaused) {
      if (logsTimer) { clearInterval(logsTimer); logsTimer = null; }
    } else {
      refreshActiveLogs();
      logsTimer = setInterval(refreshActiveLogs, 2500);
    }
  }

  for (const tab of logsTabs) {
    tab.addEventListener('click', (e) => {
      // The pause/play sub-control toggles polling for the active tab
      // without closing it. Without stopPropagation the parent button
      // click would also fire and the tab would re-open (resetting
      // paused state). Only meaningful when this tab IS the active one.
      const toggle = e.target.closest('[data-role="logs-toggle"]');
      if (toggle && activeLogsKind === tab.dataset.kind) {
        e.stopPropagation();
        toggleActiveLogsPaused();
        return;
      }
      if (activeLogsKind === tab.dataset.kind) closeLogsTabs();
      else openLogsTab(tab.dataset.kind);
    });
    updateLogsStatus(tab.dataset.kind);
  }

  $('factory-reset').onclick = openResetModal;
  $('reset-cancel').onclick = closeResetModal;
  $('reset-confirm-input').oninput = e => {
    $('reset-go').disabled = e.target.value !== 'RESET';
  };
  $('reset-go').onclick = runFactoryReset;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('reset-modal').style.display === 'flex') closeResetModal();
  });

  // If the page was opened with ?play=<40-hex-cid>, the wrapper handed
  // us an acestream:// URL via xdg-mime dispatch and the server
  // translated it into this query string. Trigger Play after the favs
  // list has settled (so the now-playing card can show the saved name
  // if the cid is in favourites), then strip the query so a reload
  // doesn't auto-play again.
  const _playCid = extractPlayCid(window.location.search);
  if (_playCid) {
    history.replaceState(null, '', window.location.pathname);
    $('cid-input').value = _playCid;
    // Desktop-entrypoint path: the user clicked an acestream:// link and
    // the engine may not be up yet. Block the UI behind the busy modal
    // until container + API are both healthy, then start playback.
    (async () => {
      const ready = await waitForEngineReady(
          'Please wait while Aceman is getting ready…');
      if (ready) play();
    })();
  }
})();
