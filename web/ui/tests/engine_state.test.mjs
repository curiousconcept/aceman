// Tests for the engine-status state machine. The transitions are
// where every "Start engine button flips mid-restart" bug has lived;
// this file pins them all down with deterministic `now` injection.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EngineStatusState,
  SETTLE_MS,
  SETTLE_MIN_HOLD_MS,
} from '../domains/playback/lib/engine/engine_state.js';

const T0 = 1_000_000;
const HEALTHY = { container: true, up: true, container_state: 'running' };
const DOWN = { container: false, up: false, container_state: 'exited' };
const MISSING = { container: false, up: false, container_state: 'missing' };
const BLIP = { container: false, up: false, container_state: 'exited' };
const UNKNOWN = { container: false, up: false, container_state: 'unknown' };

test('initial state — empty snapshot, no settle, not healthy/fresh', () => {
  const e = new EngineStatusState();
  assert.deepEqual(e.last, {});
  assert.equal(e.lastAt, 0);
  assert.equal(e.isHealthy(), false);
  assert.equal(e.isSettling(T0), false);
  assert.equal(e.isFreshSince(T0), false);
});

test('healthy poll → state.last reflects it, no settle, fresh', () => {
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  assert.equal(e.isHealthy(), true);
  assert.equal(e.isSettling(T0), false);
  assert.equal(e.lastAt, T0);
  assert.equal(e.isFreshSince(T0), true);
  assert.equal(e.isFreshSince(T0 + 1), false);
});

test('running → down edge schedules a settle window', () => {
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000); // edge!
  assert.equal(e.isSettling(T0 + 1000), true);
  assert.equal(e.settlingUntil, T0 + 1000 + SETTLE_MS);
  assert.equal(e.settlingStartedAt, T0 + 1000);
});

test('cold start with down state does NOT schedule a settle window', () => {
  // last.container is falsey on cold start, so the edge condition
  // can't fire on the very first poll.
  const e = new EngineStatusState();
  e.applyPoll(DOWN, T0);
  assert.equal(e.isSettling(T0), false);
});

test('healthy poll while settling clears the window immediately', () => {
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000);
  assert.equal(e.isSettling(T0 + 1000), true);
  e.applyPoll(HEALTHY, T0 + 2000);
  assert.equal(e.isSettling(T0 + 2000), false);
  assert.equal(e.settlingUntil, 0);
});

test('mid-restart "exited" blip BEFORE min-hold does not clear settling', () => {
  // The original bug: podman briefly reports container_state=exited
  // during a restart; without the min-hold floor we cleared settling
  // immediately and the UI flipped to "Start engine".
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000); // edge → settle starts at T0+1000
  e.applyPoll(BLIP, T0 + 1500); // 500 ms into settle, well under min-hold
  assert.equal(e.isSettling(T0 + 1500), true,
    'settling must survive the mid-restart exited blip');
});

test('genuine exited reading AFTER min-hold clears the window', () => {
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000); // settle starts at T0+1000
  e.applyPoll(DOWN, T0 + 1000 + SETTLE_MIN_HOLD_MS + 1);
  assert.equal(e.isSettling(T0 + 1000 + SETTLE_MIN_HOLD_MS + 1), false);
});

test('"missing" reading AFTER min-hold also clears the window', () => {
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000);
  e.applyPoll(MISSING, T0 + 1000 + SETTLE_MIN_HOLD_MS + 1);
  assert.equal(e.isSettling(T0 + 1000 + SETTLE_MIN_HOLD_MS + 1), false);
});

test('"unknown" reading never clears the window', () => {
  // unknown means the broker timed out — we should keep the user in
  // the wait UX rather than promote a "Start engine" button.
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000);
  e.applyPoll(UNKNOWN, T0 + 1000 + SETTLE_MIN_HOLD_MS + 10);
  assert.equal(e.isSettling(T0 + 1000 + SETTLE_MIN_HOLD_MS + 10), true);
});

test('settle window expires after SETTLE_MS', () => {
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000);
  assert.equal(e.isSettling(T0 + 1000 + SETTLE_MS - 1), true);
  assert.equal(e.isSettling(T0 + 1000 + SETTLE_MS), false);
});

test('markSettling() can be called explicitly (e.g. on Restart)', () => {
  // The /api/restart code path can't observe an edge from the poll
  // (the page is being reloaded), so it stamps a breadcrumb and the
  // post-reload init calls markSettling() up front.
  const e = new EngineStatusState();
  e.markSettling(T0);
  assert.equal(e.isSettling(T0), true);
  assert.equal(e.isSettling(T0 + SETTLE_MS - 1), true);
  assert.equal(e.isSettling(T0 + SETTLE_MS), false);
});

test('clearSettling() drops the window immediately', () => {
  const e = new EngineStatusState();
  e.markSettling(T0);
  e.clearSettling();
  assert.equal(e.isSettling(T0), false);
});

test('isFreshSince(t) only true once applyPoll has run at or after t', () => {
  const e = new EngineStatusState();
  assert.equal(e.isFreshSince(T0), false);
  e.applyPoll(HEALTHY, T0 + 500);
  assert.equal(e.isFreshSince(T0), true,
    'a poll at T0+500 satisfies "fresh since T0"');
  assert.equal(e.isFreshSince(T0 + 1000), false,
    'but does not satisfy "fresh since T0+1000"');
});

test('isReadyToDismissSince — needs a fresh poll AFTER startedAt', () => {
  // Pre-existing stale "engine up" data must NOT dismiss the modal.
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0 - 1000);          // stale snapshot from before
  const startedAt = T0;
  assert.equal(
    e.isReadyToDismissSince(startedAt, 0, T0 + 1000), false,
    'pre-existing healthy reading is not enough — would flash');
  e.applyPoll(HEALTHY, T0 + 500);            // fresh poll lands
  assert.equal(
    e.isReadyToDismissSince(startedAt, 0, T0 + 1000), true);
});

test('isReadyToDismissSince — refuses while settling', () => {
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0);
  e.applyPoll(DOWN, T0 + 1000);   // running→down edge → settle starts
  // Even a later healthy poll inside the settle window does dismiss
  // (healthy clears settling early), but a still-down poll must not.
  e.applyPoll(DOWN, T0 + 2000);
  assert.equal(
    e.isReadyToDismissSince(T0 + 2000, 0, T0 + 2000), false);
});

test('isReadyToDismissSince — enforces minVisibleMs floor', () => {
  // Even when everything else lines up, the modal can't dismiss
  // until it has been visible for at least minVisibleMs — that's
  // the rule that stops the same-tick paint/un-paint flash.
  const e = new EngineStatusState();
  e.applyPoll(HEALTHY, T0 + 100);
  const startedAt = T0;
  assert.equal(
    e.isReadyToDismissSince(startedAt, 600, T0 + 500), false,
    '500 ms in — under the 600 ms floor');
  assert.equal(
    e.isReadyToDismissSince(startedAt, 600, T0 + 600), true,
    '600 ms in — clear to dismiss');
});

test('isReadyToDismissSince — refuses when not healthy', () => {
  const e = new EngineStatusState();
  e.applyPoll(DOWN, T0 + 100);
  assert.equal(
    e.isReadyToDismissSince(T0, 0, T0 + 1000), false);
});
