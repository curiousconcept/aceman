// Pure mapping for the Play button's enable-gate.
//
// Distinct from describePlayButton (which handles ▶ vs ⏹): this
// is "is the user ALLOWED to start a new stream right now?". The
// answer depends on the engine snapshot:
//
//   * container running AND API answering → enabled, no hint.
//   * image not installed                 → disabled, pointing
//                                            the user at install.
//   * anything else (down, settling,
//     phantom container)                  → disabled, pointing
//                                            the user at Start.
//
// The "container && up" rule is intentionally strict — a phantom
// up (the port answered but the container reports down) would
// otherwise enable Play and let the user start a session against
// something we don't manage. Same rule lives in
// describeEngineToggle(); pinning it here too means a future
// regression in one place can't quietly desync from the other.
//
// Pure. No DOM, no globals.

export function describePlayButtonGate(s) {
  const snap = s || {};
  if (snap.container && snap.up) {
    return ALLOWED;
  }
  if (snap.image_installed === false) {
    return {
      disabled: true,
      hint: {
        text: 'install the engine image in Setup & tools first',
        className: 'gate-hint warn',
      },
    };
  }
  return {
    disabled: true,
    hint: {
      text: 'engine is not running — start it from the Engine card',
      className: 'gate-hint warn',
    },
  };
}

const ALLOWED = Object.freeze({
  disabled: false,
  hint: Object.freeze({ text: '', className: 'gate-hint' }),
});
