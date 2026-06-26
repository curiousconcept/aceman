// Tests for the play-time display-name resolution.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDisplayName } from '../js/domains/playback/lib/playback_display_name.js';

const CID = 'a'.repeat(40);
const CID_B = 'b'.repeat(40);
const FAVS = [
  { name: 'Saved Channel', cid: CID },
];

test('caller-provided name wins, even when a favourite would match', () => {
  // The caller knows more context (the actual row the user clicked),
  // so their name should NEVER be overridden by a fav lookup.
  const r = resolveDisplayName(
    { name: 'From Search Row', altName: 'Оригинал' }, FAVS, CID);
  assert.equal(r.name, 'From Search Row');
  assert.equal(r.sub, 'Оригинал');
});

test('missing primary, but a fav matches → use the fav name', () => {
  const r = resolveDisplayName({}, FAVS, CID);
  assert.equal(r.name, 'Saved Channel');
  assert.equal(r.sub, '');
});

test('missing primary, no fav match → empty primary', () => {
  // A raw cid the user just typed in, not saved anywhere — empty
  // primary is correct; the now-playing card will hide the line.
  const r = resolveDisplayName({}, FAVS, CID_B);
  assert.equal(r.name, '');
  assert.equal(r.sub, '');
});

test('null / undefined opts → empty pair, no crash', () => {
  assert.deepEqual(resolveDisplayName(null, [], CID),
                   { name: '', sub: '' });
  assert.deepEqual(resolveDisplayName(undefined, [], CID),
                   { name: '', sub: '' });
});

test('whitespace-only name is treated as missing', () => {
  // We don't want a render with all-whitespace text. Force the
  // fallback path instead.
  const r = resolveDisplayName({ name: '   ' }, FAVS, CID);
  assert.equal(r.name, 'Saved Channel');
});

test('trims surrounding whitespace from both name and sub', () => {
  const r = resolveDisplayName(
    { name: '  Channel  ', altName: '  Оригинал  ' }, [], CID);
  assert.equal(r.name, 'Channel');
  assert.equal(r.sub, 'Оригинал');
});

test('non-string opts fields → empty (no crash, no leaked "[object Object]")', () => {
  const r = resolveDisplayName({ name: {}, altName: 42 }, [], CID);
  assert.equal(r.name, '');
  assert.equal(r.sub, '');
});

test('case-insensitive cid match for the fav fallback', () => {
  const r = resolveDisplayName({}, FAVS, CID.toUpperCase());
  assert.equal(r.name, 'Saved Channel');
});
