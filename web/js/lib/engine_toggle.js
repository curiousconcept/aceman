// Pure mapping for the engine Start/Stop/Settling… toggle.
//
// The engine card has four user-visible states, gated by the
// (container, up, settling, image_installed) tuple:
//
//   healthy        — container running AND API answering. Button is
//                    Stop, enabled, danger-outline.
//   degraded       — container running but API silent. Same button
//                    affordance (Stop) so the user can recover.
//   settling       — we're inside a settle window (running→down edge
//                    just observed, or operator clicked Restart).
//                    Button is "Settling…", disabled, neutral class.
//   down           — container missing/exited. Button is Start,
//                    primary. If the engine image isn't installed
//                    yet, the button is gated with a guidance hint
//                    pointing the user at the install step.
//
// `s` is the broker's /api/engine/status reply; `settling` is the
// EngineStatusState.isSettling() result (the engine_state module
// owns the timing decisions and feeds us a boolean here).
//
// Pure. No DOM, no globals.

export function describeEngineToggle(s, settling = false) {
  s = s || {};
  if (s.container && s.up) {
    return {
      status: 'running',
      statusClass: 'status ok',
      button: STOP_ENABLED,
      hint: NO_HINT,
    };
  }
  if (settling) {
    // Any partial state during the settle window collapses to a
    // single disabled "Settling…" button. The status text varies
    // so the user can see *what* phase the restart is in.
    return {
      status: s.container
          ? 'restarting… (container up, API not answering)'
          : 'restarting…',
      statusClass: 'status',
      button: SETTLING,
      hint: NO_HINT,
    };
  }
  if (s.container) {
    return {
      status: 'container up, API not answering',
      statusClass: 'status bad',
      button: STOP_ENABLED,
      hint: NO_HINT,
    };
  }
  // Container is down. Start is the affordance — but block it
  // when the engine image isn't installed yet, with a hint.
  if (s.image_installed === false) {
    return {
      status: 'not running',
      statusClass: 'status bad',
      button: START_DISABLED,
      hint: { text: 'engine image not installed', className: 'gate-hint warn' },
    };
  }
  return {
    status: 'not running',
    statusClass: 'status bad',
    button: START_ENABLED,
    hint: NO_HINT,
  };
}

const STOP_ENABLED = Object.freeze({
  text: 'Stop',
  action: 'stop',
  className: 'danger-outline',
  disabled: false,
});
const START_ENABLED = Object.freeze({
  text: 'Start',
  action: 'start',
  className: 'primary',
  disabled: false,
});
const START_DISABLED = Object.freeze({
  text: 'Start',
  action: 'start',
  className: 'primary',
  disabled: true,
});
const SETTLING = Object.freeze({
  text: 'Settling…',
  action: '',
  className: '',
  disabled: true,
});
const NO_HINT = Object.freeze({ text: '', className: 'gate-hint' });
