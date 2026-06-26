// Pure mapping from an /api/desktop-entry/app response to the
// display fields the App-launcher card needs.
//
// Mirrors the shape of ./image_status.js — the policy (which
// button label, which status colour, which "danger-outline" vs
// "primary" class) is pulled out as a pure function; the DOM
// render is a thin "apply this object" loop in app.js.
//
// Input shape (matches the broker's desktop.status() reply):
//   { installed: boolean, path: string }
//
// `s` may also be null (representing a failed fetch) — we collapse
// that into the 'unavailable' state so the caller doesn't branch.

export function describeDesktopShortcutStatus(s) {
  if (!s) return UNAVAILABLE_DESKTOP;

  if (s.installed) {
    return {
      status: 'installed',
      statusClass: 'status ok',
      button: {
        text: 'Uninstall',
        action: 'uninstall',
        className: 'danger-outline',
        disabled: false,
      },
      path: s.path || '',
    };
  }
  return {
    status: 'not installed',
    statusClass: 'status',
    button: {
      text: 'Install',
      action: 'install',
      className: 'primary',
      disabled: false,
    },
    path: s.path || '',
  };
}

const UNAVAILABLE_DESKTOP = Object.freeze({
  status: 'unavailable',
  statusClass: 'status bad',
  // We still surface a button so the user can see the control exists,
  // but disable it — clicking can't succeed when the broker reply
  // failed.
  button: Object.freeze({
    text: 'Install',
    action: 'install',
    className: 'primary',
    disabled: true,
  }),
  path: '',
});
