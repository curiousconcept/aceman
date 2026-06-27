// Logs domain. Three tabs share one viewer: clicking a tab opens it and
// polls that stream every 2.5 s; clicking the active tab closes it. Each
// tab shows its log size via a one-shot fetch when the viewer opens. A
// ⏸ control pauses the active tab; the viewer also auto-pauses while the
// user has text selected so a refresh doesn't clobber the selection.
import { $ } from '../../shared/dom.js';
import { api } from '../../shared/api.js';

export function initLogs() {
  let activeLogsKind = null;
  let logsTimer = null;
  let activeLogsPaused = false;       // explicit ⏸ pause
  let logsViewerAutoPaused = false;   // pause while text is selected
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
}
