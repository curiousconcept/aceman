// Tests for the modal-lifecycle runner.
//
// We don't load jsdom — a hand-rolled fake `overlay` (just a
// .style.display field) and a tiny fake event target are enough to
// exercise every transition.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runModal } from '../js/lib/modal.js';

function fakeOverlay() {
  return { style: { display: 'none' } };
}

function fakeTarget() {
  const listeners = new Map(); // type → Set(fn)
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    listenerCount(type) {
      return listeners.has(type) ? listeners.get(type).size : 0;
    },
  };
}

test('opens the overlay and waits', async () => {
  const overlay = fakeOverlay();
  const eventTarget = fakeTarget();
  let done;
  const p = runModal({ overlay, eventTarget }, d => { done = d; });
  assert.equal(overlay.style.display, 'flex');
  done('chosen');
  assert.equal(await p, 'chosen');
  assert.equal(overlay.style.display, 'none');
});

test('Escape resolves with null', async () => {
  const overlay = fakeOverlay();
  const eventTarget = fakeTarget();
  const p = runModal({ overlay, eventTarget }, () => {});
  eventTarget.dispatch('keydown', { key: 'Escape' });
  assert.equal(await p, null);
});

test('non-Escape keys are ignored', async () => {
  const overlay = fakeOverlay();
  const eventTarget = fakeTarget();
  let done;
  const p = runModal({ overlay, eventTarget }, d => { done = d; });
  eventTarget.dispatch('keydown', { key: 'Enter' });
  eventTarget.dispatch('keydown', { key: 'a' });
  // Still open — we haven't resolved yet.
  assert.equal(overlay.style.display, 'flex');
  done(7);
  assert.equal(await p, 7);
});

test('keydown listener is removed on close', async () => {
  const overlay = fakeOverlay();
  const eventTarget = fakeTarget();
  let done;
  const p = runModal({ overlay, eventTarget }, d => { done = d; });
  assert.equal(eventTarget.listenerCount('keydown'), 1);
  done(null);
  await p;
  assert.equal(eventTarget.listenerCount('keydown'), 0,
    'no listener leaks past close');
});

test('setup cleanup function is invoked on close', async () => {
  const overlay = fakeOverlay();
  const eventTarget = fakeTarget();
  let cleaned = false;
  const p = runModal({ overlay, eventTarget }, done => {
    setTimeout(() => done('x'), 0);
    return () => { cleaned = true; };
  });
  await p;
  assert.equal(cleaned, true);
});

test('setup may return nothing — close still works', async () => {
  const overlay = fakeOverlay();
  const eventTarget = fakeTarget();
  const p = runModal({ overlay, eventTarget }, done => done(42));
  assert.equal(await p, 42);
});

test('missing overlay throws synchronously', () => {
  assert.throws(() => runModal({ overlay: null }, () => {}),
                /overlay element is required/);
});

test('missing event target throws when document is unavailable', () => {
  // We can't delete `document` in Node — and that's the point of the
  // fallback — so we only verify the explicit-null pathway here.
  assert.throws(() =>
    runModal({ overlay: fakeOverlay(), eventTarget: null }, () => {}),
    /no event target/);
});
