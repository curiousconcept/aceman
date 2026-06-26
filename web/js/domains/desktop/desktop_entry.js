// Desktop-entry / launcher card: status badge + install / uninstall of
// the .desktop file (optionally registering the acestream:// scheme
// handler). The status→display mapping is pure and unit-tested in
// lib/cards/desktop_shortcut_status.js; this is the DOM + the calls.
//
// Hidden in WSL mode — writing a Linux .desktop file from a
// Windows-served session would be confusing at best. `isWslMode` is a
// transitional back-ref from app.js (set during init) until config is
// its own module.

import { $, showError } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { runModal } from '../../lib/modal.js';
import { describeDesktopShortcutStatus } from './lib/desktop_shortcut_status.js';
import { isWslMode } from '../../shared/runtime.js';

export async function refreshDesktopEntry() {
  // No-op in WSL mode — the App-launcher row is hidden and writing
  // a Linux .desktop file from a Windows-served session would be
  // confusing at best, broken at worst.
  if (isWslMode) return;
  let s = null;
  try { s = await api('/api/desktop-entry/app'); }
  catch (_) { /* leave s = null; describeDesktopShortcutStatus collapses to 'unavailable' */ }

  const view = describeDesktopShortcutStatus(s);
  $('desktop-status').textContent = view.status;
  $('desktop-status').className = view.statusClass;

  // Path is broker-supplied and only meaningful when the fetch
  // succeeded. Tooltip on the .has-tooltip label surfaces the
  // exact filesystem location for the user.
  $('desktop-path').textContent = view.path;
  if (view.path) $('desktop-label').title = view.path;

  const btn = $('desktop-toggle');
  btn.textContent = view.button.text;
  btn.dataset.action = view.button.action;
  btn.className = view.button.className;
  btn.disabled = view.button.disabled;
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

export async function toggleDesktopEntry() {
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
