// Tests for the trailing-edge debounce.
//
// We inject a fake setTimeout/clearTimeout so the tests don't have
// to sleep. The fakes record scheduled callbacks; we trigger them
// manually to step through time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from '../js/lib/debounce.js';

function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map(); // id → { fn, ms }
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clearTimeout: id => { scheduled.delete(id); },
    fire: id => {
      const entry = scheduled.get(id);
      if (!entry) throw new Error(`fire: unknown timer ${id}`);
      scheduled.delete(id);
      entry.fn();
    },
    count: () => scheduled.size,
    ids: () => Array.from(scheduled.keys()),
  };
}

test('single call → fires after the delay', () => {
  const t = fakeTimers();
  let calls = 0;
  const f = debounce(() => { calls++; }, 100, t);
  f();
  assert.equal(calls, 0, 'not fired immediately');
  t.fire(t.ids()[0]);
  assert.equal(calls, 1, 'fires once the timer pops');
});

test('rapid calls collapse to one trailing fire', () => {
  const t = fakeTimers();
  let calls = 0;
  const f = debounce(() => { calls++; }, 100, t);
  f(); f(); f();
  assert.equal(t.count(), 1, 'only one outstanding timer');
  t.fire(t.ids()[0]);
  assert.equal(calls, 1);
});

test('latest arguments win', () => {
  const t = fakeTimers();
  const seen = [];
  const f = debounce((x) => { seen.push(x); }, 100, t);
  f(1); f(2); f(3);
  t.fire(t.ids()[0]);
  assert.deepEqual(seen, [3]);
});

test('cancel() drops the pending call', () => {
  const t = fakeTimers();
  let calls = 0;
  const f = debounce(() => { calls++; }, 100, t);
  f();
  f.cancel();
  assert.equal(t.count(), 0, 'pending timer cleared');
  assert.equal(calls, 0);
});

test('cancel() after fire is harmless', () => {
  const t = fakeTimers();
  const f = debounce(() => {}, 100, t);
  f();
  t.fire(t.ids()[0]);
  assert.doesNotThrow(() => f.cancel());
});

test('factory throws when no timers are available', () => {
  const saved = { setTimeout: globalThis.setTimeout,
                  clearTimeout: globalThis.clearTimeout };
  try {
    delete globalThis.setTimeout;
    delete globalThis.clearTimeout;
    assert.throws(() => debounce(() => {}, 100), /no timer functions/);
  } finally {
    globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout;
  }
});
