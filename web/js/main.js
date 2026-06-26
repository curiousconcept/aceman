// main.js is the bootstrap, loaded as an ES module from index.html. It
// wires the DOM to the domains and runs init. Pure helpers live
// under ./lib/ and are unit-tested under web/js_tests/. Everything in
// THIS file is the wiring between the DOM, the broker, and those
// helpers — there's nothing here a JS test should be poking at
// directly. Add new pure logic to a lib module first.
import { parseId } from './lib/playback/content_id_parser.js';
import { $, showError, showConfirm, showBusy, hideBusy } from './shared/dom.js';
import { api } from './shared/api.js';
import { mountAcemanSelect } from './shared/dropdown.js';
import { openResetModal, closeResetModal, runFactoryReset } from './domains/factory-reset/factory_reset.js';
import { initGpuCard, buildGpuParams, gpuEncodeLabel } from './domains/gpu/gpu.js';
import { refreshImageStatus, installImage, uninstallImage } from './domains/image/image.js';
import { refreshDesktopEntry, toggleDesktopEntry } from './domains/desktop/desktop_entry.js';
import { loadPlayers, loadBrowsers, detectCurrentBrowser,
         detectedPlayers, detectedBrowsers, _currentBrowserName } from './domains/playback/detection.js';
import { KEYS } from './lib/storage_keys.js';
import { onSearchInput, refreshSearchSection, refreshClearButton, clearCidInput,
         runSearch, searchPagePrev, searchPageNext } from './domains/search/search.js';
import { loadLastPlay } from './lib/playback/last_played_stream.js';
import { extractPlayCidFromUrl } from './lib/playback/play_query_param.js';
import { bufferLabel } from './lib/playback/playback_buffer.js';
import { describeFavouritesStorageBadge } from './lib/favourites/favourites_storage_badge.js';
import { resolveDisplayName } from './lib/favourites/playback_display_name.js';
import { hideHistorySection, openHistoryDropdown, closeHistoryDropdown,
         historyDropdownOpen } from './domains/history/history.js';
import { allFavs, browserFavs, loadFavs, updateSaveButton, saveFav,
         setFavSearch, favPagePrev, favPageNext } from './domains/favourites/favourites.js';
import { current, livePlaybackTarget, cfg, play, renderPlaybackTargets,
         restartStream, refreshEngineStatus, engineState, clearNowPlaying,
         setTabTitle, setNowPlayingName, persistPlaybackTarget, waitForEngineReady,
         waitForBackend, refreshPlayerRowAlignment, movePlaybackToSelection,
         toggleEngine, saveAutostart, notifyRestartNeeded,
         alignSearchToInput, setCfg, setCurrent } from './domains/playback/playback.js';
import { mode, isWslMode, setMode, setWslMode } from './shared/runtime.js';

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
  // Hold behind the "please wait" modal until the web backend is
  // actually answering — otherwise a desktop-entry cold start drops the
  // user onto a fully-interactive page behind a bare NetworkError while
  // the server is still coming up. Once this returns true the calls
  // below succeed immediately; the timeout path falls through to the
  // existing catch, which paints the actionable error.
  await waitForBackend();
  try {
    const cfg = await api('/api/storage-mode');
    setMode(cfg.mode);
    // Engine URL surfaces as a hover tooltip on the Engine corner-label
    // (with the .has-tooltip dashed underline as the visual hint).
    if (cfg.engine) $('engine-label').title = cfg.engine;
    // Search sources, one per line. The label this used to attach to
    // was the standalone "Find streams" card, which folded into the
    // Watch card. We surface the hint on #search-status (the small
    // status pill next to the Watch title) instead — it only paints
    // when a search is active anyway.
    const searchStatus = $('search-status');
    if (searchStatus) {
      const srcs = Array.isArray(cfg.search_sources) ? cfg.search_sources : [];
      if (srcs.length) {
        searchStatus.title = srcs.length === 1
            ? `Source: ${srcs[0]}`
            : `Sources:\n  ${srcs.join('\n  ')}`;
      } else {
        searchStatus.title = '';
      }
    }
    const badge = describeFavouritesStorageBadge(mode, cfg.favorites_path);
    $('storage-badge').textContent = badge.text;
    $('storage-badge').title = badge.title;
    // Hide Linux-desktop-only affordances when served to a Windows-side browser.
    setWslMode(!!cfg.is_wsl);
    if (isWslMode) {
      // App launcher row: no xdg-mime or .desktop on Windows
      const desktopRow = $('desktop-row');
      if (desktopRow) desktopRow.style.display = 'none';
      // Player / browser selector: Linux-side targets aren't reachable
      // from the Windows browser. Hide the selection UI but keep the
      // buffer slider — in WSL you're always playing in-browser so it's
      // the most relevant control on the card.
      const playerSelectRow = $('player-select-row');
      if (playerSelectRow) playerSelectRow.style.display = 'none';
      const showAllRow = $('show-all-row');
      if (showAllRow) showAllRow.style.display = 'none';
      const playerHint = $('player-hint');
      if (playerHint) playerHint.style.display = 'none';
      // Rename card label to reflect the remaining content
      const playerLabel = document.querySelector('#player-card .card-label');
      if (playerLabel) playerLabel.textContent = 'Playback';
    }
  } catch (e) {
    showError('Could not contact backend: ' + e.message);
  }

  try {
    setCfg(await api('/api/config'));
    $('autostart').checked = !!cfg.engine_autostart;
  } catch (_) { /* config endpoint may be disabled */ }

  // Favourites first; engine status second so the page doesn't flash
  // "engine offline" for a tick while loadFavs awaits the DB read.
  await loadFavs();
  await loadPlayers();
  await loadBrowsers();
  initGpuCard();  // fire-and-forget; card appears when broker responds
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

  // Container memory row (below Lifecycle buttons) — polls both web and
  // engine containers every 8 s. Each cell hides itself when unavailable.
  const MEM_WARN_BYTES = 100 * 1024 * 1024;
  const _fmtBytes = (b) => {
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GiB';
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(0) + ' MiB';
    if (b >= 1024)      return (b / 1024).toFixed(0) + ' KiB';
    return b + ' B';
  };
  const _applyMemCell = (cellId, displayId, hintId, envKey, data) => {
    const cell = $(cellId);
    if (!cell) return;
    if (!data.available) { cell.style.display = 'none'; return; }
    const display = $(displayId);
    const hint    = $(hintId);
    if (display) display.textContent = `${_fmtBytes(data.mem_bytes)} / ${_fmtBytes(data.limit_bytes)}`;
    const nearLimit = data.limit_bytes > 0 &&
                      (data.limit_bytes - data.mem_bytes) < MEM_WARN_BYTES;
    cell.classList.toggle('mem-cell-warn', nearLimit);
    if (hint) {
      hint.textContent = nearLimit ? `— consider raising ${envKey}` : '';
      hint.style.display = nearLimit ? '' : 'none';
    }
    // Update tooltip on the label span with actual current limit
    const label = cell.querySelector('.tip');
    if (label && data.limit_bytes > 0) {
      const cur = _fmtBytes(data.limit_bytes);
      const cfgFile = '~/.config/aceman/env';
      label.dataset.tip =
        `Current limit: ${cur}\nTo change: add ${envKey}=2g to ${cfgFile}\nthen restart.`;
    }
    cell.style.display = '';
  };
  const refreshContainerMemory = async () => {
    const row = $('container-mem-row');
    if (!row) return;
    try {
      const [webMem, engMem] = await Promise.all([
        fetch('/api/web/memory').then(r => r.json()),
        fetch('/api/engine/memory').then(r => r.json()),
      ]);
      _applyMemCell('web-mem-cell', 'web-mem-display', 'web-mem-hint', 'ACE_WEB_MEMORY', webMem);
      _applyMemCell('eng-mem-cell', 'eng-mem-display', 'eng-mem-hint', 'ACE_MEMORY',     engMem);
      const anyVisible = ($('web-mem-cell') && $('web-mem-cell').style.display !== 'none')
                      || ($('eng-mem-cell') && $('eng-mem-cell').style.display !== 'none');
      row.style.display = anyVisible ? 'flex' : 'none';
    } catch (_) {
      if (row) row.style.display = 'none';
    }
  };
  refreshContainerMemory();
  setInterval(refreshContainerMemory, 8000);

  // The Play button toggles between ▶ (idle) and ⏹ (something playing
   // — anywhere: this tab, another browser, vlc, mpv). Clicking it in
   // the stop state tears down everything: in-browser proxy if any,
   // and any host-side wrapper holding mpv/vlc. The fav touch flow is
   // play()'s responsibility, not stop's.
  $('restream-btn').onclick = () => restartStream();

  $('play-btn').onclick = async () => {
    if (livePlaybackTarget) {
      showBusy('Stopping…');
      try {
        try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
        catch (_) { /* best-effort */ }
        // Stop = "I'm done watching that" — clean every visible
        // referent in one step instead of leaving stale bits behind:
        //   clearNowPlaying()  resets the Watch card title to its
        //                      empty state, hides the video element,
        //                      drops the channel name from the tab
        //                      title, kills the in-browser proxy if
        //                      one was running, clears `current`
        //                      (so the Save-as-fav button hides),
        //                      and triggers refreshPlaybackMoveButton.
        //   clearCidInput()    wipes the cid from the Watch input so
        //                      the operator can type a new search
        //                      without first hand-deleting the old
        //                      value. Favourites is right below if
        //                      they want the same thing back.
        //   updateSaveButton() picks up the cleared `current` and
        //                      hides the "Saved as <name>" button
        //                      that lingered with stale text.
        clearNowPlaying();
        clearCidInput();
        updateSaveButton();
      } finally { hideBusy(); }
    } else {
      showBusy('Starting…');
      try { await play(); } finally { hideBusy(); }
    }
  };
  // Unified Watch input — drives BOTH play (on Enter/Play-button) and
  // search (debounced, on every keystroke when the value isn't a cid).
  // refreshSearchSection() decides whether the results panel paints.
  $('cid-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    // Cancel any pending debounced search — Enter is an explicit
    // action ("play this now"). If the value is a free-text query
    // we still kick a synchronous search before Play so the user sees
    // results immediately; play() itself bails on non-cid input
    // anyway (parseId returns null and play surfaces "invalid id").
    if (parseId($('cid-input').value) === null) { runSearch(); return; }
    play();
  });
  $('cid-input').addEventListener('input', () => {
    closeHistoryDropdown();
    hideHistorySection();
    refreshSearchSection();
    refreshClearButton();
    onSearchInput();
  });
  $('cid-input').addEventListener('dblclick', e => {
    if ($('cid-input').value !== '') return; // non-empty → standard text-select
    e.preventDefault();
    if (historyDropdownOpen()) { closeHistoryDropdown(); return; }
    openHistoryDropdown();
  });
  $('cid-clear').onclick = clearCidInput;
  $('save-btn').onclick = saveFav;
  $('engine-toggle').onclick = toggleEngine;
  $('autostart').onchange = saveAutostart;
  $('playback-target').onchange = () => persistPlaybackTarget($('playback-target').value);
  $('playback-move').onclick = () => movePlaybackToSelection();
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
  // Stats line toggle — click to hide, "Display Stats" button to restore.
  {
    let statsHidden = localStorage.getItem(KEYS.STATS_HIDDEN) === '1';
    const applyStatsVis = () => {
      const s = $('pb-video-status');
      const b = $('show-stats-btn');
      if (!s || !b) return;
      s.style.display = statsHidden ? 'none' : '';
      b.style.display = statsHidden ? '' : 'none';
    };
    applyStatsVis();
    const pbStatus = $('pb-video-status');
    if (pbStatus) {
      pbStatus.onclick = () => {
        statsHidden = true;
        localStorage.setItem(KEYS.STATS_HIDDEN, '1');
        applyStatsVis();
      };
      pbStatus.oncontextmenu = e => {
        e.preventDefault();
        const text = pbStatus.textContent;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          const prev = pbStatus.style.opacity;
          pbStatus.style.opacity = '1';
          pbStatus.style.color = 'var(--acc)';
          setTimeout(() => {
            pbStatus.style.opacity = prev;
            pbStatus.style.color = '';
          }, 600);
        }).catch(() => {});
      };
    }
    const showStatsBtn = $('show-stats-btn');
    if (showStatsBtn) showStatsBtn.onclick = () => {
      statsHidden = false;
      localStorage.setItem(KEYS.STATS_HIDDEN, '0');
      applyStatsVis();
    };
  }

  // In-tab pre-roll buffer slider. 0 = Off (live edge). Read at play time.
  {
    const bufSlider = $('playback-buffer');
    const bufOut    = $('playback-buffer-out');
    if (bufSlider) {
      bufSlider.max = '60';
      const storedVal = parseInt(localStorage.getItem(KEYS.PLAYBACK_BUFFER) || '0', 10);
      bufSlider.value = String(Math.min(Math.max(storedVal, 0), 60));
      if (bufOut) bufOut.textContent = bufferLabel(bufSlider.value, 60);
      // Seed the server from localStorage on load, so the aceman CLI's
      // buffer_secs is never stale even when the slider isn't touched this
      // session. Fire-and-forget; harmless no-op if server config is off.
      api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ buffer_secs: Math.min(Math.max(storedVal, 0), 60) }),
      }).catch(() => {});
      bufSlider.oninput = () => {
        const n = Math.min(Math.max(parseInt(bufSlider.value, 10), 0), 60);
        localStorage.setItem(KEYS.PLAYBACK_BUFFER, String(n));
        if (bufOut) bufOut.textContent = bufferLabel(n, 60);
      };
      // On release, persist server-side too (config.json:buffer_secs) so the
      // aceman CLI applies the same seconds to the external player's network
      // cache. Fire-and-forget: localStorage already drives in-tab playback,
      // and a disabled server config (404) is a harmless no-op here.
      bufSlider.onchange = () => {
        const n = Math.min(Math.max(parseInt(bufSlider.value, 10), 0), 60);
        api('/api/config', {
          method: 'POST', body: JSON.stringify({ buffer_secs: n }),
        }).catch(() => {});
        notifyRestartNeeded();   // buffer change applies on next stream start
      };
    }
  }
  // (pb-stop button removed — Play button itself toggles to Stop.)
  $('fav-search').oninput = e => setFavSearch(e.target.value);
  $('fav-prev').onclick = favPagePrev;
  $('fav-next').onclick = favPageNext;
  // The old #search-input is gone — the Watch card's unified
  // #cid-input handles both modes (see the input listeners above).
  $('search-prev').onclick = searchPagePrev;
  $('search-next').onclick = searchPageNext;
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
    if (!(await showConfirm({
      title: 'Quit aceman',
      message: 'Shut down aceman and stop the engine container?',
      confirmText: 'Quit',
      danger: true,
    }))) return;
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

  // Restart: opens a modal that lets the operator pick whether to
  // rebuild the images before bouncing. Default is "just bounce" —
  // rebuilding is opt-in because it (a) takes longer and (b) bakes
  // whatever's currently on disk into the image, which only makes
  // sense if the operator trusts those changes. The modal probes
  // /api/restart/preflight to decide whether to paint the "new
  // changes detected" warning next to the checkbox.
  async function openRestartModal() {
    $('restart-modal').style.display = 'flex';
    $('restart-rebuild-cb').checked = false;
    $('restart-rebuild-warn').style.display = 'none';
    try {
      const r = await api('/api/restart/preflight');
      if (r && r.rebuild_recommended) {
        $('restart-rebuild-warn').style.display = '';
      }
    } catch (_) { /* preflight is best-effort; no warning if it fails */ }
  }
  function closeRestartModal() {
    $('restart-modal').style.display = 'none';
  }
  $('server-restart').onclick = openRestartModal;
  $('restart-cancel').onclick = closeRestartModal;
  $('restart-go').onclick = async () => {
    const rebuild = $('restart-rebuild-cb').checked;
    closeRestartModal();
    // Block the underlying UI behind the existing busy modal while
    // the restart is in flight. Same overlay used for play/stop
    // transitions and engine-startup waits, so the look is
    // consistent. The page itself stays intact behind the backdrop
    // (no document.body replacement) so a cancelled / timed-out
    // restart leaves the operator on a working UI rather than a
    // text-only error page they have to reload by hand.
    showBusy(rebuild
        ? 'Restarting and rebuilding images… this may take a minute.'
        : 'Restarting…');
    const btn = $('server-restart');
    btn.disabled = true;
    btn.textContent = 'Restarting…';
    // Breadcrumb the post-reload init will consume to mark the engine
    // as "settling" — otherwise the fresh JS has no transition to
    // detect (engineState.last is empty on cold start) and shows the
    // user a tempting "Start engine" button mid-restart.
    sessionStorage.setItem(KEYS.RESTARTED_AT, String(Date.now()));
    try {
      await api('/api/restart', {
        method: 'POST',
        body: JSON.stringify({ rebuild }),
      });
    } catch (_) { /* connection close is expected */ }
    // Poll until the new instance responds, then reload. The probe
    // window is wider when rebuild=true because podman build (even
    // with the layer cache hot) can add a handful of seconds.
    const start = Date.now();
    const timeoutMs = rebuild ? 180_000 : 30_000;
    const ping = async () => {
      if (Date.now() - start > timeoutMs) {
        hideBusy();
        btn.disabled = false;
        btn.textContent = 'Restart';
        showError('Restart timed out after '
                + Math.round(timeoutMs / 1000)
                + ' s — check the terminal or tools/tail-web.sh.');
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
  // Set when the user clicks inside the viewer to select text; cleared
  // on mousedown outside. Separate from activeLogsPaused so the ⏸
  // button continues to work as an explicit override.
  let logsViewerAutoPaused = false;
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
      logsViewer.textContent = (r.tail || '(log is empty — no activity yet)').replace(/\\u000a/g, '\n');
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
    logsViewerAutoPaused = false;
    logsViewer.classList.remove('viewer-paused');
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
    logsViewerAutoPaused = false;
    logsViewer.classList.remove('viewer-paused');
    for (const t of logsTabs) t.classList.remove('active');
    logsViewer.style.display = 'none';
  }

  function toggleActiveLogsPaused() {
    if (!activeLogsKind) return;
    activeLogsPaused = !activeLogsPaused;
    if (!activeLogsPaused) {
      logsViewerAutoPaused = false;
      logsViewer.classList.remove('viewer-paused');
    }
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

  // Auto-pause scroll when the user clicks inside the log viewer so
  // they can select text without the refresh clobbering the selection.
  logsViewer.addEventListener('mousedown', () => {
    if (!activeLogsKind || activeLogsPaused) return;
    logsViewerAutoPaused = true;
    logsViewer.classList.add('viewer-paused');
    toggleActiveLogsPaused();
  });

  // Resume as soon as the user clicks outside the viewer (but not on
  // the ⏸ toggle — that button handles itself via the tab click handler).
  document.addEventListener('mousedown', (e) => {
    if (!logsViewerAutoPaused) return;
    if (logsViewer.contains(e.target)) return;
    if (e.target.closest('[data-role="logs-toggle"]')) return;
    logsViewerAutoPaused = false;
    logsViewer.classList.remove('viewer-paused');
    if (activeLogsPaused) toggleActiveLogsPaused();
  });

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
  const _playCid = extractPlayCidFromUrl(window.location.search);
  if (_playCid) {
    history.replaceState(null, '', window.location.pathname);
    $('cid-input').value = _playCid;
    // Desktop-entrypoint path: the user clicked an acestream:// link and
    // the engine may not be up yet. Block the UI behind the busy modal
    // until container + API are both healthy, then start playback.
    // skipConfirm: this URL was either opened by /api/open-in-browser
    // (already-confirmed hand-off) or pasted by the user; either way
    // they already expressed intent. The browser-target confirm would
    // be redundant noise.
    (async () => {
      const ready = await waitForEngineReady(
          'Please wait while Aceman is getting ready…');
      if (ready) play({ skipConfirm: true });
    })();
  } else {
    // No ?play= in URL: rehydrate the input from the last-played
    // stash so a refresh in the middle of in-tab/browser playback
    // doesn't blank the cid. The external-player rehydration path
    // in refreshEngineStatus only fires when a host-side wrapper
    // is alive; the in-browser case has no wrapper, so without
    // this the user loses the cid even though we saved it on play().
    const last = loadLastPlay(localStorage);
    if (last && last.cid && /^[a-f0-9]{40}$/.test(last.cid)) {
      $('cid-input').value = last.cid;
      // Make the ✕ visible — refreshClearButton's display gate is
      // input.value, so any code path that sets the value
      // programmatically (rehydrate / play / fav click) needs to
      // poke this for the button to actually appear.
      refreshClearButton();
      refreshSearchSection();
      // Render the channel name in the now-playing card too — the
      // stash carries the name/sub snapshot from play(), but if the
      // cid showed up in favourites only AFTER that play (or was
      // renamed since), resolveDisplayName against the current
      // allFavs list wins. allFavs is filled by the parallel init
      // IIFE's loadFavs await, so try twice: once immediately for
      // the fast path, once after favs have settled.
      const renderName = () => {
        const { name, sub } =
            resolveDisplayName(last, allFavs, last.cid);
        if (!name) return;
        setCurrent({ cid: last.cid, name, altName: sub });
        setTabTitle(name);
        setNowPlayingName(name, sub);
        $('now-playing').style.display = 'block';
        updateSaveButton();
      };
      renderName();
      // Backup pass for the case where allFavs was still empty on
      // first render (init IIFE hadn't awaited /api/favs yet).
      setTimeout(renderName, 800);
    }
  }

  // Re-align the search results panel whenever the play card resizes
  // (viewport change, sidebar appearing/disappearing, zoom).
  if (window.ResizeObserver) {
    const playCard = $('play-card');
    if (playCard) new ResizeObserver(() => alignSearchToInput()).observe(playCard);
    const playerCard = $('player-card');
    if (playerCard) new ResizeObserver(() => refreshPlayerRowAlignment()).observe(playerCard);
  }
})();

// Debug telemetry: type d → b → g (outside any input) to show a
// 3-second viewport-size overlay. Useful for reporting layout issues.
(function () {
  const SEQ = 'dbg';
  let buf = '', timer = null, hideTimer = null;
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    clearTimeout(timer);
    buf += e.key.toLowerCase();
    buf = buf.slice(-SEQ.length);
    if (buf === SEQ) {
      buf = '';
      const el = document.getElementById('dbg-overlay');
      if (!el) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const bw = document.body.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      // Two SEPARATE markers, server-injected:
      //   build  — content hash of the served page + web backend (.py).
      //            The reliable "am I on the version I just rebuilt?"
      //            signal; present in every mode, independent of podman.
      //   commit — git SHA (+ dirty). A nicety; may be empty (dirty tree
      //            with no env, or a broker recreate that didn't carry it)
      //            WITHOUT meaning the build is wrong — that's why it's its
      //            own field, not folded into the hash.
      // NOTE: never reference the literal injection sentinels here — the
      // server's page-wide replace would clobber them and break the guard.
      const build = el.dataset.build || '';
      const commit = el.dataset.commit || '';
      const text = `${vw} x ${vh}px  body ${bw}px  DPR ${dpr}`
        + (build ? `  build ${build}` : '')
        + (commit ? `  commit ${commit}` : '');
      el.innerHTML =
        `${vw} &times; ${vh}px &nbsp;&#183;&nbsp; body&nbsp;${bw}px &nbsp;&#183;&nbsp; DPR&nbsp;${dpr}`
        + (build ? ` &nbsp;&#183;&nbsp; build&nbsp;${build}` : '')
        + (commit ? ` &nbsp;&#183;&nbsp; commit&nbsp;${commit}` : '');
      el.classList.add('visible');
      clearTimeout(hideTimer);
      navigator.clipboard.writeText(text).catch(() => {});
      hideTimer = setTimeout(() => el.classList.remove('visible'), 3000);
      return;
    }
    timer = setTimeout(() => { buf = ''; }, 1500);
  });
}());
