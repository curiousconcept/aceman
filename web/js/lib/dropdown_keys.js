// Pure keyboard semantics for the custom dropdown (shared/dropdown.js).
// Maps a key + the listbox open-state to an intent, with no DOM access —
// the widget translates the intent into focus/selection moves. Kept here
// (central lib/) because the dropdown is shared UI, and the branching is
// exactly the part worth pinning under unit test.
//
// Returns { action, preventDefault, dir? }:
//   'open'   — open the listbox (closed → any nav/confirm key opens it)
//   'move'   — move focus by `dir` (+1 down, -1 up) within an open listbox
//   'select' — confirm the focused option (caller guards on there being one)
//   'close'  — close the listbox
//   'none'   — ignore the key
export function dropdownKeyAction(key, isOpen) {
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const dir = key === 'ArrowDown' ? 1 : -1;
    return isOpen
      ? { action: 'move', dir, preventDefault: true }
      : { action: 'open', preventDefault: true };
  }
  if (key === 'Enter' || key === ' ') {
    return isOpen
      ? { action: 'select', preventDefault: true }
      : { action: 'open', preventDefault: true };
  }
  if (key === 'Escape') {
    // Only swallow Escape when we actually closed something.
    return isOpen
      ? { action: 'close', preventDefault: true }
      : { action: 'none', preventDefault: false };
  }
  // Tab closes but lets focus move on naturally (no preventDefault).
  if (key === 'Tab') return { action: 'close', preventDefault: false };
  return { action: 'none', preventDefault: false };
}
