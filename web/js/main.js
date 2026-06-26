// Bootstrap: wires the DOM to the domains and runs init. Pure logic
// belongs in a lib module (tested under web/js_tests/), not here.
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
import { loadLastPlay } from './domains/playback/lib/last_played_stream.js';
import { extractPlayCidFromUrl } from './domains/playback/lib/play_query_param.js';
import { bufferLabel } from './domains/playback/lib/playback_buffer.js';
import { describeFavouritesStorageBadge } from './domains/favourites/lib/favourites_storage_badge.js';
import { resolveDisplayName } from './domains/playback/lib/playback_display_name.js';
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
  // ACEMAN wordmark glow toggle. Default ON; click the title to flip
  // .glow, persisted across sessions.
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

  // Identify the current browser before loadBrowsers' first dropdown
  // render, so it can label/filter same-name entries from the start.
  await detectCurrentBrowser();
  // Hold behind the "please wait" modal until the backend answers, so a
  // cold start doesn't drop the user onto a live page behind a
  // NetworkError. On timeout the calls below fall to the catch.
  await waitForBackend();
  try {
    const cfg = await api('/api/storage-mode');
    setMode(cfg.mode);
    // Engine URL as a hover tooltip on the Engine corner-label.
    if (cfg.engine) $('engine-label').title = cfg.engine;
    // Search sources, one per line, surfaced as a tooltip on the
    // #search-status pill next to the Watch title.
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
      // App launcher row: no xdg-mime or .desktop on Windows.
      const desktopRow = $('desktop-row');
      if (desktopRow) desktopRow.style.display = 'none';
      // Player/browser selector: Linux-side targets are unreachable from
      // the Windows browser. Hide selection, keep the buffer slider
      // (WSL always plays in-browser).
      const playerSelectRow = $('player-select-row');
      if (playerSelectRow) playerSelectRow.style.display = 'none';
      const showAllRow = $('show-all-row');
      if (showAllRow) showAllRow.style.display = 'none';
      const playerHint = $('player-hint');
      if (playerHint) playerHint.style.display = 'none';
      // Rename card label to reflect the remaining content.
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
  // "engine offline" while loadFavs awaits the DB read.
  await loadFavs();
  await loadPlayers();
  await loadBrowsers();
  initGpuCard();  // fire-and-forget; card appears when broker responds
  // Replace the native <select> popup with the CSS-styled dropdown
  // (Firefox/Linux otherwise forces a system-purple option highlight).
  mountAcemanSelect($('playback-target'));
  // Just back from a Restart: mark the engine settling so the first
  // poll's likely "not running" reading doesn't promote a "Start
  // engine" button mid-bounce. Honor only breadcrumbs younger than 60s.
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
    // Tooltip on the label span shows the current limit.
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

  // The Play button toggles ▶ (idle) / ⏹ (playing anywhere — this tab,
  // another browser, vlc, mpv). Stop tears down the in-browser proxy
  // and any host-side wrapper holding mpv/vlc.
  $('restream-btn').onclick = () => restartStream();

  $('play-btn').onclick = async () => {
    if (livePlaybackTarget) {
      showBusy('Stopping…');
      try {
        try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
        catch (_) { /* best-effort */ }
        // Stop clears every visible referent in one step:
        //   clearNowPlaying()  resets the Watch card, hides the video,
        //                      clears the tab title, kills the in-browser
        //                      proxy, and clears `current`.
        //   clearCidInput()    wipes the cid so a new search can be typed.
        //   updateSaveButton() hides the now-stale Save-as-fav button.
        clearNowPlaying();
        clearCidInput();
        updateSaveButton();
      } finally { hideBusy(); }
    } else {
      showBusy('Starting…');
      try { await play(); } finally { hideBusy(); }
    }
  };
  // Unified Watch input — drives play (Enter/Play button) and search
  // (debounced per keystroke when the value isn't a cid).
  $('cid-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    // Free-text value: search now rather than play (play() bails on a
    // non-cid anyway).
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
  // "Show all browser installs" — UI-only preference in localStorage.
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
      // Seed the server from localStorage on load so the aceman CLI's
      // buffer_secs isn't stale when the slider goes untouched.
      api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ buffer_secs: Math.min(Math.max(storedVal, 0), 60) }),
      }).catch(() => {});
      bufSlider.oninput = () => {
        const n = Math.min(Math.max(parseInt(bufSlider.value, 10), 0), 60);
        localStorage.setItem(KEYS.PLAYBACK_BUFFER, String(n));
        if (bufOut) bufOut.textContent = bufferLabel(n, 60);
      };
      // On release, persist server-side (config.json:buffer_secs) so the
      // aceman CLI applies the same seconds to the external player cache.
      bufSlider.onchange = () => {
        const n = Math.min(Math.max(parseInt(bufSlider.value, 10), 0), 60);
        api('/api/config', {
          method: 'POST', body: JSON.stringify({ buffer_secs: n }),
        }).catch(() => {});
        notifyRestartNeeded();   // buffer change applies on next stream start
      };
    }
  }
  $('fav-search').oninput = e => setFavSearch(e.target.value);
  $('fav-prev').onclick = favPagePrev;
  $('fav-next').onclick = favPageNext;
  $('search-prev').onclick = searchPagePrev;
  $('search-next').onclick = searchPageNext;
  $('desktop-toggle').onclick = toggleDesktopEntry;
  refreshDesktopEntry();

  $('image-install').onclick = installImage;
  $('image-uninstall').onclick = uninstallImage;
  refreshImageStatus();

  // Manual "Quit" — POST /api/shutdown stops the engine container and
  // tears down the web server. Explicit action, so we stop everything.
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

  // Restart modal: optionally rebuild images before bouncing. Default
  // is "just bounce" (rebuild is slower and bakes on-disk state into the
  // image). Preflight decides whether to show the "new changes" warning.
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
    // Block the UI behind the busy modal while the restart is in flight.
    // The page stays intact behind the backdrop, so a timed-out restart
    // leaves a working UI rather than a text-only error page.
    showBusy(rebuild
        ? 'Restarting and rebuilding images… this may take a minute.'
        : 'Restarting…');
    const btn = $('server-restart');
    btn.disabled = true;
    btn.textContent = 'Restarting…';
    // Breadcrumb consumed by the post-reload init to mark the engine
    // "settling" (fresh JS has no transition to detect on cold start).
    sessionStorage.setItem(KEYS.RESTARTED_AT, String(Date.now()));
    try {
      await api('/api/restart', {
        method: 'POST',
        body: JSON.stringify({ rebuild }),
      });
    } catch (_) { /* connection close is expected */ }
    // Poll until the new instance responds, then reload. Wider window
    // for rebuild=true since podman build adds a few seconds.
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
  // Three tabs share one viewer: clicking a tab opens it and polls that
  // stream; clicking the active tab closes it. Each tab shows its log
  // size via a one-shot fetch when the viewer opens.
  let activeLogsKind = null;
  let logsTimer = null;
  // Explicit ⏸ pause for the active tab.
  let activeLogsPaused = false;
  // Auto-pause while the user has text selected in the viewer. Separate
  // from activeLogsPaused so the ⏸ button stays an explicit override.
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
      // lines=1: we only want size_bytes + available for the indicator.
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
      // Neutral gray — size is informational, not a health signal.
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
      // The ⏸ sub-control toggles polling without closing the tab.
      // stopPropagation keeps the parent click from re-opening it.
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

  // Auto-pause on click inside the viewer so a refresh doesn't clobber
  // a text selection.
  logsViewer.addEventListener('mousedown', () => {
    if (!activeLogsKind || activeLogsPaused) return;
    logsViewerAutoPaused = true;
    logsViewer.classList.add('viewer-paused');
    toggleActiveLogsPaused();
  });

  // Resume on click outside the viewer (the ⏸ toggle handles itself).
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

  // ?play=<40-hex-cid> means an acestream:// URL was dispatched here via
  // xdg-mime. Strip the query (so reload doesn't re-play) and start.
  const _playCid = extractPlayCidFromUrl(window.location.search);
  if (_playCid) {
    history.replaceState(null, '', window.location.pathname);
    $('cid-input').value = _playCid;
    // Engine may not be up yet — block behind the busy modal until
    // container + API are healthy, then play. skipConfirm: opening this
    // URL already expressed intent, so skip the browser-target confirm.
    (async () => {
      const ready = await waitForEngineReady(
          'Please wait while Aceman is getting ready…');
      if (ready) play({ skipConfirm: true });
    })();
  } else {
    // No ?play=: rehydrate the input from the last-played stash so a
    // refresh during in-tab/browser playback doesn't blank the cid
    // (the in-browser case has no wrapper to rehydrate from).
    const last = loadLastPlay(localStorage);
    if (last && last.cid && /^[a-f0-9]{40}$/.test(last.cid)) {
      $('cid-input').value = last.cid;
      // Programmatic value set doesn't trigger the ✕ gate; poke it.
      refreshClearButton();
      refreshSearchSection();
      // Render the channel name. resolveDisplayName prefers the current
      // allFavs entry (renames win) over the stash snapshot. allFavs may
      // still be loading, so render now and again once favs settle.
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
      setTimeout(renderName, 800);  // retry once favs have loaded
    }
  }

  // Re-align the search results panel when the play card resizes.
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
      // Two server-injected markers:
      //   build  — content hash of the served page + web backend (.py);
      //            the version signal, independent of podman.
      //   commit — git SHA (+ dirty); may be empty without meaning the
      //            build is wrong, hence a separate field.
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
