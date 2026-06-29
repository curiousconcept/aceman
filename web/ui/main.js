// Bootstrap: wires the DOM to the domains and runs init. Pure logic
// belongs in a lib module (tested under web/js_tests/), not here. Every
// import below is a domain's public interface (domains/<x>/index.js) or
// the shared/lib substrate — never a file behind a domain boundary.
import { $, showError, showBusy, hideBusy } from './shared/dom.js';
import { api } from './shared/api.js';
import { mountAcemanSelect } from './shared/dropdown.js';
import { mode, noLocalDesktop, setMode, setNoLocalDesktop } from './shared/runtime.js';
import { KEYS } from './lib/storage_keys.js';
import { initWordmark } from './domains/wordmark/index.js';
import { initDiagnostics } from './domains/diagnostics/index.js';
import { initLifecycle } from './domains/lifecycle/index.js';
import { openResetModal, closeResetModal, runFactoryReset } from './domains/factory-reset/index.js';
import { initGpuCard, buildGpuParams, gpuEncodeLabel } from './domains/gpu/index.js';
import { refreshImageStatus, installImage, uninstallImage } from './domains/image/index.js';
import { initContainerMemory } from './domains/container-memory/index.js';
import { initLogs } from './domains/logs/index.js';
import { refreshDesktopEntry, toggleDesktopEntry } from './domains/desktop/index.js';
import { onSearchInput, refreshSearchSection, refreshClearButton, clearCidInput,
         runSearch, searchPagePrev, searchPageNext } from './domains/search/index.js';
import { describeFavouritesStorageBadge, allFavs, browserFavs, loadFavs,
         updateSaveButton, saveFav, setFavSearch, favPagePrev, favPageNext } from './domains/favourites/index.js';
import { hideHistorySection, openHistoryDropdown, closeHistoryDropdown,
         historyDropdownOpen } from './domains/history/index.js';
import { parseId, loadPlayers, loadBrowsers, detectCurrentBrowser, detectedPlayers,
         detectedBrowsers, _currentBrowserName, loadLastPlay, extractPlayCidFromUrl,
         resolveDisplayName, current, livePlaybackTarget, cfg, play, initPlaybackControls,
         renderPlaybackTargets, restartStream, refreshEngineStatus, engineState,
         clearNowPlaying, setTabTitle, setNowPlayingName,
         waitForEngineReady, waitForBackend, refreshPlayerRowAlignment,
         movePlaybackToSelection, toggleEngine, toggleLanExpose, onPlaybackTargetChange, refreshDeviceStream, copyPlayingCid, toggleDeviceLink, saveAutostart,
         alignSearchToInput, setCfg, setCurrent } from './domains/playback/index.js';

// ---- init --------------------------------------------------------------
(async () => {
  initWordmark();

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
    // Hide Linux-desktop-only affordances when the browser is on another host.
    setNoLocalDesktop(!!cfg.no_local_desktop);
    if (noLocalDesktop) {
      // App launcher row: no Linux desktop to write a .desktop file to.
      const desktopRow = $('desktop-row');
      if (desktopRow) desktopRow.style.display = 'none';
      // Host-side players/browsers are unreachable from a browser on
      // another host, so renderPlaybackTargets trims the "Play in" list to
      // just "This tab" + "Another device" — keep the selector visible for
      // that choice, but drop the dedup toggle + no-target hint, which
      // don't apply.
      const showAllRow = $('show-all-row');
      if (showAllRow) showAllRow.style.display = 'none';
      const playerHint = $('player-hint');
      if (playerHint) playerHint.style.display = 'none';
    }
  } catch (e) {
    showError('Could not contact backend: ' + e.message);
  }

  try {
    setCfg(await api('/api/config'));
    $('autostart').checked = !!cfg.engine_autostart;
    // Search sources (proxy on by default, engine opt-in).
    $('src-aceproxy').checked = cfg.search_aceproxy !== false;
    $('src-engine').checked = !!cfg.search_engine;
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

  initContainerMemory();

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
    refreshDeviceStream();   // keep the device QR in sync while typing
  });
  $('cid-input').addEventListener('dblclick', e => {
    if ($('cid-input').value !== '') return; // non-empty → standard text-select
    e.preventDefault();
    if (historyDropdownOpen()) { closeHistoryDropdown(); return; }
    openHistoryDropdown();
  });
  $('cid-clear').onclick = () => { clearCidInput(); refreshDeviceStream(); };
  // Click the playing title or the now-playing id chip → copy the Ace ID
  // and put it back in the Watch box. (No-op while idle.)
  $('playback-title').onclick = copyPlayingCid;
  $('now-playing-id').onclick = copyPlayingCid;
  $('save-btn').onclick = saveFav;
  $('engine-toggle').onclick = toggleEngine;
  $('autostart').onchange = saveAutostart;
  $('lan-expose').onchange = toggleLanExpose;
  $('device-stream-qr').onclick = toggleDeviceLink;
  $('playback-target').onchange = onPlaybackTargetChange;
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
  initPlaybackControls();   // stats line toggle + in-tab buffer slider

  $('fav-search').oninput = e => setFavSearch(e.target.value);
  $('fav-prev').onclick = favPagePrev;
  $('fav-next').onclick = favPageNext;
  $('search-prev').onclick = searchPagePrev;
  $('search-next').onclick = searchPageNext;
  // Search-source toggles: persist the flag, then re-run the current query
  // so results reflect the new source set immediately.
  const saveSearchSrc = async (key, el) => {
    try {
      setCfg(await api('/api/config', {
        method: 'POST', body: JSON.stringify({ [key]: el.checked }),
      }));
    } catch (e) {
      showError(e.message);
      el.checked = !el.checked;   // revert on failure
      return;
    }
    runSearch();
  };
  $('src-aceproxy').onchange = () => saveSearchSrc('search_aceproxy', $('src-aceproxy'));
  $('src-engine').onchange = () => saveSearchSrc('search_engine', $('src-engine'));
  $('desktop-toggle').onclick = toggleDesktopEntry;
  refreshDesktopEntry();

  $('image-install').onclick = installImage;
  $('image-uninstall').onclick = uninstallImage;
  refreshImageStatus();

  initLifecycle();   // Quit (shutdown) + Restart modal
  initLogs();

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

// Registered synchronously at load (outside the async init) so the
// d→b→g shortcut works even if the backend handshake is still pending.
initDiagnostics();
