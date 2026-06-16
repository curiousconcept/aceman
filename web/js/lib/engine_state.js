// Engine-status state machine.
//
// The /api/engine/status poll returns a snapshot of container + API
// liveness. Driving the UI off a single poll directly is buggy — the
// engine briefly transits 'exited' during a `podman restart`, which
// reads as "down" for ~1 s even though it's mid-restart. We solve
// this with a settle window: once we observe a running→down
// transition (or call markSettling() explicitly on /api/restart),
// we treat the engine as "settling" for SETTLE_MS, and the UI
// renders a disabled "Settling…" toggle instead of "Start engine"
// so an impatient click can't spawn a second container.
//
// The settle window has a minimum-hold floor (SETTLE_MIN_HOLD_MS):
// 'exited' / 'missing' container states only clear the window after
// it has been held for that long. That way the mid-restart blip
// can't end the wait prematurely.
//
// This file is the pure transition core: no DOM, no fetch, no
// globals. The wiring around it (poll, render, hydrate) lives in
// app.js; everything testable lives here.

export const SETTLE_MS = 15_000;
export const SETTLE_MIN_HOLD_MS = 6_000;

export class EngineStatusState {
  constructor() {
    this.last = {};
    this.lastAt = 0;
    this.settlingUntil = 0;
    this.settlingStartedAt = 0;
  }

  // Begin a settle window. Called either from applyPoll() when a
  // running→down edge is observed, or explicitly when the operator
  // hits Restart (the wrapper respawn briefly cycles the container).
  markSettling(now = Date.now()) {
    this.settlingUntil = now + SETTLE_MS;
    this.settlingStartedAt = now;
  }

  // Drop a settle window immediately. Used when applyPoll observes a
  // fully-healthy reading or the held-enough exit condition. Exposed
  // so call sites can force-clear if they need to (e.g. when the
  // operator manually starts the engine via the toggle).
  clearSettling() {
    this.settlingUntil = 0;
    this.settlingStartedAt = 0;
  }

  // Fold a fresh status snapshot into the state. Performs the three
  // transitions described above and stores the snapshot + timestamp
  // for later read access. Returns the snapshot for chaining.
  applyPoll(s, now = Date.now()) {
    // running→down edge → schedule a settle window.
    if (this.last && this.last.container && this.last.up
        && !(s.container && s.up)) {
      this.markSettling(now);
    }
    // After the minimum hold, a truly-dead container reading clears
    // the window. 'unknown' (broker timeout) doesn't clear — we let
    // the user keep the wait UX in that case.
    const heldEnough = this.settlingStartedAt
                       && now - this.settlingStartedAt >= SETTLE_MIN_HOLD_MS;
    if (heldEnough && (s.container_state === 'exited' ||
                       s.container_state === 'missing')) {
      this.clearSettling();
    }
    // Fully-healthy reading clears the window early — no point
    // waiting on a thing that's already up.
    if (s.container && s.up) this.clearSettling();

    this.last = s;
    this.lastAt = now;
    return s;
  }

  // True while we're inside the settle window AND the engine is
  // not yet healthy. Both clauses matter — once we see container+up
  // we want the UI to flip to "running" immediately, even if the
  // window's nominal end hasn't been reached.
  isSettling(now = Date.now()) {
    const s = this.last;
    return !(s && s.container && s.up) && now < this.settlingUntil;
  }

  // True iff applyPoll() has stored a snapshot at or after `t`.
  // waitForEngineReady uses this to refuse same-tick stale reads.
  isFreshSince(t) { return this.lastAt >= t; }

  // True iff the last snapshot reports container + HTTP API both up.
  isHealthy() {
    const s = this.last;
    return !!(s && s.container && s.up);
  }

  // The "is the engine actually ready to dismiss the busy modal?"
  // predicate. Folds together every guard the modal needs in order
  // to avoid the same-tick stale-read flash + the mid-restart
  // settle window + the minimum-visible-duration floor.
  //
  // Returns true only when ALL of:
  //   * a poll has landed at or after `startedAt`
  //   * we are NOT currently inside a settle window
  //   * the modal has been visible for at least `minVisibleMs`
  //   * the latest snapshot is fully healthy (container + up)
  isReadyToDismissSince(startedAt, minVisibleMs, now = Date.now()) {
    return this.isFreshSince(startedAt)
        && !this.isSettling(now)
        && (now - startedAt) >= minVisibleMs
        && this.isHealthy();
  }
}
