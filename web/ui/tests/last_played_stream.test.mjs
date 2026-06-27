// Tests for the lastPlay persistence helpers.
//
// The cid validation is a security boundary: any other script in
// this origin can mutate localStorage, so we never want a bogus
// value flowing back into play() or the cid input. These tests pin
// down every "should be rejected" case.

import test from 'node:test';
import assert from 'node:assert/strict';
import { saveLastPlay, loadLastPlay, clearLastPlay }
  from '../domains/playback/lib/last_played_stream.js';
import { KEYS } from '../lib/storage_keys.js';

const CID = 'a'.repeat(40);
const CID2 = 'b'.repeat(40);

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _peek: () => Object.fromEntries(m),
  };
}

test('saveLastPlay — valid cid is stored under the right key', () => {
  const ls = fakeStorage();
  assert.equal(saveLastPlay(ls, { cid: CID, name: 'X', sub: 'Y' }), true);
  const stored = JSON.parse(ls.getItem(KEYS.LAST_PLAY));
  assert.deepEqual(stored, { cid: CID, name: 'X', sub: 'Y' });
});

test('saveLastPlay — uppercase cid is canonicalised to lowercase', () => {
  const ls = fakeStorage();
  saveLastPlay(ls, { cid: CID.toUpperCase(), name: '', sub: '' });
  const stored = JSON.parse(ls.getItem(KEYS.LAST_PLAY));
  assert.equal(stored.cid, CID);
});

test('saveLastPlay — refuses non-40-hex cid', () => {
  const ls = fakeStorage();
  for (const bad of [null, '', 'z'.repeat(40), CID + 'x', CID.slice(0, 39)]) {
    assert.equal(saveLastPlay(ls, { cid: bad }), false,
      `should refuse cid=${JSON.stringify(bad)}`);
  }
  assert.equal(ls.getItem(KEYS.LAST_PLAY), null,
               'storage left untouched');
});

test('saveLastPlay — optional fields default to empty string', () => {
  const ls = fakeStorage();
  saveLastPlay(ls, { cid: CID });
  const stored = JSON.parse(ls.getItem(KEYS.LAST_PLAY));
  assert.equal(stored.name, '');
  assert.equal(stored.sub, '');
});

test('saveLastPlay — survives storage that throws (private mode)', () => {
  const ls = { setItem: () => { throw new Error('quota'); }, getItem: () => null,
               removeItem: () => {} };
  assert.doesNotThrow(() =>
    assert.equal(saveLastPlay(ls, { cid: CID }), false));
});

test('loadLastPlay — round-trips a saved entry', () => {
  const ls = fakeStorage();
  saveLastPlay(ls, { cid: CID, name: 'Channel', sub: 'Original' });
  assert.deepEqual(loadLastPlay(ls),
                   { cid: CID, name: 'Channel', sub: 'Original' });
});

test('loadLastPlay — missing key → null', () => {
  assert.equal(loadLastPlay(fakeStorage()), null);
});

test('loadLastPlay — malformed JSON → null (no throw)', () => {
  const ls = fakeStorage({ [KEYS.LAST_PLAY]: '{ not json' });
  assert.equal(loadLastPlay(ls), null);
});

test('loadLastPlay — bogus cid in storage → null', () => {
  // Critical: this is the trust-boundary check. A user-/extension-
  // injected value must NEVER reach play() unfiltered.
  const inject = { [KEYS.LAST_PLAY]:
    JSON.stringify({ cid: 'javascript:alert(1)', name: 'x' }) };
  assert.equal(loadLastPlay(fakeStorage(inject)), null);
});

test('loadLastPlay — non-object payload → null', () => {
  const ls = fakeStorage({ [KEYS.LAST_PLAY]: '"a string"' });
  assert.equal(loadLastPlay(ls), null);
});

test('loadLastPlay — valid cid but non-string name/sub coerce to empty', () => {
  // A partial / tampered payload (right cid, garbage labels) must not
  // surface a number or object as the display name — exercise the
  // `typeof parsed.name === "string" ? … : ""` arms.
  const ls = fakeStorage({ [KEYS.LAST_PLAY]:
    JSON.stringify({ cid: CID, name: 123, sub: { x: 1 } }) });
  assert.deepEqual(loadLastPlay(ls), { cid: CID, name: '', sub: '' });
});

test('loadLastPlay — survives storage that throws', () => {
  const ls = { getItem: () => { throw new Error('boom'); },
               setItem: () => {}, removeItem: () => {} };
  assert.equal(loadLastPlay(ls), null);
});

test('clearLastPlay — removes the key', () => {
  const ls = fakeStorage();
  saveLastPlay(ls, { cid: CID });
  clearLastPlay(ls);
  assert.equal(ls.getItem(KEYS.LAST_PLAY), null);
});

test('clearLastPlay — survives storage that throws', () => {
  const ls = { removeItem: () => { throw new Error('nope'); },
               getItem: () => null, setItem: () => {} };
  assert.doesNotThrow(() => clearLastPlay(ls));
});

test('all helpers are no-op on null storage (no crash)', () => {
  assert.equal(saveLastPlay(null, { cid: CID }), false);
  assert.equal(loadLastPlay(null), null);
  assert.doesNotThrow(() => clearLastPlay(null));
});

test('save/load round trip preserves a different cid', () => {
  const ls = fakeStorage();
  saveLastPlay(ls, { cid: CID2, name: 'two', sub: '' });
  const r = loadLastPlay(ls);
  assert.equal(r.cid, CID2);
  assert.equal(r.name, 'two');
});
