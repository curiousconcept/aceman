// Tests for the storage-key registry and the acewatch→aceman
// migration sweep.

import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, migrateLegacy } from '../js/lib/storage_keys.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _peek: () => Object.fromEntries(m),
  };
}

test('KEYS is frozen — name typos at call sites surface in tests', () => {
  assert.throws(() => { KEYS.FAVORITES = 'pwned'; });
});

test('KEYS includes every namespace we currently use', () => {
  for (const k of [
    'FAVORITES', 'LAST_PLAY', 'GLOW',
    'SHOW_ALL_BROWSERS', 'RESTARTED_AT',
  ]) {
    assert.ok(KEYS[k], `missing KEYS.${k}`);
    assert.ok(KEYS[k].startsWith('aceman.'),
      `KEYS.${k} should be under the aceman namespace`);
  }
});

test('migrateLegacy on empty storage — no-op', () => {
  const ls = fakeStorage();
  const r = migrateLegacy(ls);
  assert.deepEqual(r, { migrated: [], skipped: [] });
  assert.deepEqual(ls._peek(), {});
});

test('migrateLegacy copies an old key to the new name', () => {
  const ls = fakeStorage();
  ls.setItem('acewatch.favorites', '[{"name":"x","cid":"a"}]');
  migrateLegacy(ls);
  assert.equal(ls.getItem('aceman.favorites'),
               '[{"name":"x","cid":"a"}]');
  assert.equal(ls.getItem('acewatch.favorites'), null,
               'old key removed after copy');
});

test('migrateLegacy is idempotent — re-running is a no-op', () => {
  const ls = fakeStorage();
  ls.setItem('acewatch.favorites', '[]');
  migrateLegacy(ls);
  const snap = ls._peek();
  migrateLegacy(ls);
  assert.deepEqual(ls._peek(), snap);
});

test('migrateLegacy does NOT overwrite an existing new key', () => {
  // The user may have written a fresh value under the new name; we
  // must not clobber it with a stale legacy value.
  const ls = fakeStorage();
  ls.setItem('acewatch.favorites', 'legacy');
  ls.setItem('aceman.favorites', 'current');
  migrateLegacy(ls);
  assert.equal(ls.getItem('aceman.favorites'), 'current',
               'current value preserved');
  assert.equal(ls.getItem('acewatch.favorites'), null,
               'legacy is still cleaned up');
});

test('migrateLegacy migrates every documented legacy key', () => {
  const ls = fakeStorage();
  ls.setItem('acewatch.favorites', 'A');
  ls.setItem('acewatch.acemanGlow', 'B');
  ls.setItem('acewatch.lastPlay', 'C');
  ls.setItem('acewatch.showAllBrowsers', 'D');
  migrateLegacy(ls);
  assert.equal(ls.getItem('aceman.favorites'), 'A');
  assert.equal(ls.getItem('aceman.acemanGlow'), 'B');
  assert.equal(ls.getItem('aceman.lastPlay'), 'C');
  assert.equal(ls.getItem('aceman.showAllBrowsers'), 'D');
});

test('migrateLegacy survives a getItem that throws', () => {
  // Some browsers throw on storage access in private mode. The
  // migration must not crash the app boot.
  const ls = {
    getItem: () => { throw new Error('private-mode'); },
    setItem: () => {},
    removeItem: () => {},
  };
  assert.doesNotThrow(() => migrateLegacy(ls));
});

test('migrateLegacy on null storage returns an empty report', () => {
  assert.deepEqual(migrateLegacy(null), { migrated: [], skipped: [] });
});
