// Pure mapping from an /api/engine/image response to the display
// fields the engine-image card needs.
//
// The render function in app.js was a 60-line if/else over s.state,
// s.installed, s.log_tail, and s.error — touching the DOM at every
// branch. Splitting the policy from the DOM lets us pin every state
// down with deterministic tests, and the DOM render becomes a thin
// "apply this object" loop.
//
// Input shape (matches the broker's image.status() reply):
//   {
//     state: 'building' | 'idle' | 'unknown',
//     installed: boolean,
//     tag: string,
//     log_tail: string[],   // optional
//     error: string,         // optional
//   }
//
// `s` may also be null (representing a failed fetch) — we collapse
// that into the 'unavailable' state so the caller doesn't need to
// branch.

export function describeContainerImageStatus(s) {
  if (!s) return UNAVAILABLE_CONTAINER_IMAGE;

  if (s.state === 'building') {
    const log = s.log_tail || [];
    return {
      status: 'building…',
      statusClass: 'status',
      installButton: { text: 'Building…', disabled: true },
      uninstallEnabled: false,
      // Show the log expanded while building so the user can watch
      // progress without an extra click.
      log: { visible: true, expanded: true, lines: log },
      errorHint: '',
      pollAgain: true,
    };
  }

  const log = s.log_tail || [];
  if (s.installed) {
    return {
      status: 'installed',
      statusClass: 'status ok',
      installButton: { text: 'Rebuild', disabled: false },
      uninstallEnabled: true,
      // After the build finishes, keep the wrapper visible (so the
      // log is still available) but collapsed by default.
      log: { visible: log.length > 0, expanded: false, lines: log },
      errorHint: s.error || '',
      pollAgain: false,
    };
  }

  return {
    status: 'not installed',
    statusClass: 'status bad',
    installButton: { text: 'Install', disabled: false },
    uninstallEnabled: false,
    log: { visible: log.length > 0, expanded: false, lines: log },
    errorHint: s.error || '',
    pollAgain: false,
  };
}

const UNAVAILABLE_CONTAINER_IMAGE = Object.freeze({
  status: 'unavailable',
  statusClass: 'status bad',
  installButton: { text: 'Install', disabled: true },
  uninstallEnabled: false,
  log: { visible: false, expanded: false, lines: [] },
  errorHint: '',
  pollAgain: false,
});
