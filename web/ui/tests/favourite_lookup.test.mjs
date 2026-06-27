// Tests for the favourites-lookup helper.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findFavouriteByCid } from '../domains/favourites/lib/favourite_lookup.js';

const CID_A = 'a'.repeat(40);
const CID_B = 'b'.repeat(40);
const FAVS = [
  { name: 'Channel A', cid: CID_A },
  { name: 'Channel B', cid: CID_B },
];

test('finds an entry by exact lowercase cid', () => {
  assert.equal(findFavouriteByCid(FAVS, CID_A).name, 'Channel A');
});

test('finds an entry case-insensitively (uppercase query)', () => {
  assert.equal(findFavouriteByCid(FAVS, CID_A.toUpperCase()).name, 'Channel A');
});

test('finds an entry case-insensitively (mixed-case stored cid)', () => {
  // The engine occasionally hands back mixed-case cids; we should
  // still match against a lowercase needle.
  const favs = [{ name: 'Mixed', cid: 'AbCdEf' + 'a'.repeat(34) }];
  const needle = ('AbCdEf' + 'a'.repeat(34)).toLowerCase();
  assert.equal(findFavouriteByCid(favs, needle).name, 'Mixed');
});

test('returns null when nothing matches', () => {
  assert.equal(findFavouriteByCid(FAVS, 'c'.repeat(40)), null);
});

test('returns null on empty / non-array favs', () => {
  assert.equal(findFavouriteByCid([], CID_A), null);
  assert.equal(findFavouriteByCid(null, CID_A), null);
  assert.equal(findFavouriteByCid(undefined, CID_A), null);
});

test('returns null on empty / non-string cid', () => {
  assert.equal(findFavouriteByCid(FAVS, ''), null);
  assert.equal(findFavouriteByCid(FAVS, null), null);
  assert.equal(findFavouriteByCid(FAVS, 42), null);
});

test('skips entries with malformed shape (defensive)', () => {
  // Corrupted localStorage in browser-mode favourites could hand
  // us entries without .cid; the helper should walk past them
  // instead of throwing.
  const favs = [
    null,
    { name: 'no cid' },
    { cid: 123 },                    // wrong type
    { name: 'real', cid: CID_A },
  ];
  assert.equal(findFavouriteByCid(favs, CID_A).name, 'real');
});

test('returns the FIRST matching entry when duplicates exist', () => {
  // Both backends enforce cid uniqueness, but defensive code in
  // the rest of the app reads "exists or not" — pin the behaviour
  // so a duplicate doesn't return a random one.
  const favs = [
    { name: 'first', cid: CID_A },
    { name: 'second', cid: CID_A },
  ];
  assert.equal(findFavouriteByCid(favs, CID_A).name, 'first');
});
