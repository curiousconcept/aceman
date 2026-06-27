// Shared DOM helpers used across every feature module.
//
// Business-agnostic glue: the `$` id-lookup shorthand, the inline
// error line, the themed confirm dialog (replacing the OS-native
// confirm() so it matches our palette), and the busy overlay. No
// feature logic lives here — just the primitives the views reuse.

export const $ = id => document.getElementById(id);

export function showError(msg) {
  const el = $('err');
  el.textContent = msg || '';
}

// Themed replacement for the browser-native confirm() dialog. Same
// boolean return shape (Promise<bool>) so callers stay simple:
//   if (!(await showConfirm({ title, message }))) return;
// Native confirm() paints in the OS's own colours (blue accents on
// most platforms), which broke our mustard palette every time it
// fired. The custom modal lives in #confirm-modal in index.html and
// shares CSS with reset-modal / restart-modal / install-modal.
export function showConfirm({ title, message, confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const modal = $('confirm-modal');
    const go = $('confirm-go');
    const cancel = $('confirm-cancel');
    if (!modal || !go || !cancel) { resolve(false); return; }
    $('confirm-title').textContent = title || 'Confirm';
    $('confirm-message').textContent = message || '';
    go.textContent = confirmText;
    // danger=true swaps the primary mustard button for the dark-red
    // danger button so destructive confirms (Uninstall, Quit, Delete
    // favourite) read as such at a glance.
    go.className = danger ? 'danger' : 'primary';
    modal.style.display = 'flex';
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    function done(v) {
      modal.style.display = 'none';
      go.onclick = null;
      cancel.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(v);
    }
    go.onclick = () => done(true);
    cancel.onclick = () => done(false);
    document.addEventListener('keydown', onKey);
    // Focus the Cancel button by default so an accidental Enter
    // doesn't fire a destructive action.
    setTimeout(() => cancel.focus(), 0);
  });
}

export function showBusy(msg) {
  const m = $('busy-modal'); if (!m) return;
  const t = $('busy-modal-msg'); if (t) t.textContent = msg || 'Working…';
  m.style.display = 'flex';
}

export function hideBusy() {
  const m = $('busy-modal'); if (m) m.style.display = 'none';
}
