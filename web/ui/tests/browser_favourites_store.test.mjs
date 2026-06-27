// Tests for the browser-side favourites store.
//
// We inject a Map-backed fake `localStorage` so tests are fully
// hermetic — no global state, no race-via-singleton, no dependency
// on any browser API.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFavouritesStore } from '../domains/favourites/lib/browser_favourites_store.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

test('empty store → list() returns []', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  assert.deepEqual(f.list(), []);
});

test('add() persists and keeps list alphabetical (case-insensitive)', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  f.add('zeta', 'a'.repeat(40));
  f.add('Alpha', 'b'.repeat(40));
  f.add('beta', 'c'.repeat(40));
  const names = f.list().map(x => x.name);
  assert.deepEqual(names, ['Alpha', 'beta', 'zeta']);
});

test('add() — duplicate cid under different name throws with existingName', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  const cid = 'a'.repeat(40);
  f.add('first', cid);
  let err;
  try { f.add('second', cid); } catch (e) { err = e; }
  assert.ok(err, 'expected an error');
  assert.equal(err.existingName, 'first');
});

test('add() — re-adding same name+cid is idempotent', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  const cid = 'a'.repeat(40);
  f.add('same', cid);
  f.add('same', cid); // no throw, no dupe row
  assert.equal(f.list().length, 1);
});

test('delete() removes the named entry and leaves others alone', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  f.add('a', '1'.padEnd(40, '1'));
  f.add('b', '2'.padEnd(40, '2'));
  f.delete('a');
  const names = f.list().map(x => x.name);
  assert.deepEqual(names, ['b']);
});

test('rename() updates the name in place', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  const cid = 'a'.repeat(40);
  f.add('old', cid);
  f.rename('old', 'new');
  assert.equal(f.list()[0].name, 'new');
});

test('rename() — target name already in use throws', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  f.add('one', '1'.padEnd(40, '1'));
  f.add('two', '2'.padEnd(40, '2'));
  assert.throws(() => f.rename('one', 'two'),
                /already in use/);
});

test('rename() — unknown source throws', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  assert.throws(() => f.rename('nope', 'whatever'),
                /not found/);
});

test('touchCid() stamps last_played for matching rows only', () => {
  const f = createBrowserFavouritesStore(fakeStorage());
  const cidA = '1'.padEnd(40, '1');
  const cidB = '2'.padEnd(40, '2');
  f.add('a', cidA);
  f.add('b', cidB);
  f.touchCid(cidA);
  const rows = f.list();
  const a = rows.find(r => r.name === 'a');
  const b = rows.find(r => r.name === 'b');
  assert.ok(a.last_played, 'a should have a timestamp');
  assert.equal(b.last_played, null);
});

test('list() — corrupted JSON in storage returns [] gracefully', () => {
  const ls = fakeStorage();
  ls.setItem('aceman.favorites', '{ not valid');
  const f = createBrowserFavouritesStore(ls);
  assert.deepEqual(f.list(), []);
});

test('createBrowserFavouritesStore — no storage backend throws', () => {
  assert.throws(() => createBrowserFavouritesStore(null),
                /no storage backend/);
});

test('falls back to the global localStorage when none is passed', () => {
  // Production calls createBrowserFavouritesStore() with no argument and
  // relies on the global localStorage — exercise that fallback arm with
  // a stand-in so the test stays hermetic.
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const saved = globalThis.localStorage;
  try {
    globalThis.localStorage = fakeStorage();
    const f = createBrowserFavouritesStore();
    f.add('solo', 'a'.repeat(40));
    assert.deepEqual(f.list().map(x => x.name), ['solo']);
  } finally {
    if (had) globalThis.localStorage = saved; else delete globalThis.localStorage;
  }
});
