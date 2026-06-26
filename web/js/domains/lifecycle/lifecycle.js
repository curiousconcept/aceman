// Lifecycle domain: server-level ops — Quit (shutdown) and Restart
// (optionally rebuilding images). Both POST to /api/* and then either
// replace the page (quit) or poll-and-reload once the new instance
// answers (restart).
import { $, showError, showConfirm, showBusy, hideBusy } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { KEYS } from '../../lib/storage_keys.js';

export function initLifecycle() {
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
}
