// Tests for the page-query helpers.
//
// extractPlayCidFromUrl is a trust boundary: any other origin's redirect
// or the user's own bookmark can stuff arbitrary text into the
// `play` query parameter. We MUST never lift the raw value into
// play() — every test here pins down a class of bogus input that
// must collapse to null.

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlayCidFromUrl } from '../js/domains/playback/lib/play_query_param.js';

const CID = 'a'.repeat(40);

test('extracts a valid 40-hex cid', () => {
  assert.equal(extractPlayCidFromUrl(`?play=${CID}`), CID);
});

test('lowercases an uppercase cid', () => {
  assert.equal(extractPlayCidFromUrl(`?play=${CID.toUpperCase()}`), CID);
});

test('returns null when the param is missing', () => {
  assert.equal(extractPlayCidFromUrl('?foo=bar'), null);
  assert.equal(extractPlayCidFromUrl('?play='), null);
  assert.equal(extractPlayCidFromUrl(''), null);
});

test('rejects non-hex characters', () => {
  assert.equal(extractPlayCidFromUrl(`?play=${'z'.repeat(40)}`), null);
  assert.equal(extractPlayCidFromUrl(`?play=${CID.slice(0, 39)}g`), null);
});

test('rejects wrong-length tokens', () => {
  assert.equal(extractPlayCidFromUrl(`?play=${'a'.repeat(39)}`), null);
  assert.equal(extractPlayCidFromUrl(`?play=${'a'.repeat(41)}`), null);
});

test('rejects acestream:// scheme injection attempts', () => {
  // The cid parser strips `acestream://`, so a value like
  // `acestream://aa…aa/extra` would still be rejected on length —
  // pin that.
  assert.equal(extractPlayCidFromUrl('?play=acestream://' + CID + '/extra'), null);
});

test('rejects javascript: and other URL-shaped values', () => {
  assert.equal(extractPlayCidFromUrl('?play=javascript:alert(1)'), null);
  assert.equal(extractPlayCidFromUrl('?play=http://evil/' + CID), null);
});

test('returns null for non-string input (no crash)', () => {
  assert.equal(extractPlayCidFromUrl(null), null);
  assert.equal(extractPlayCidFromUrl(undefined), null);
  assert.equal(extractPlayCidFromUrl(42), null);
});

test('honors only the first `play=` when duplicated', () => {
  // URLSearchParams.get() returns the first value when a key
  // appears more than once. Confirm the policy: we don't accidentally
  // race the values or pick the more-permissive one.
  assert.equal(
    extractPlayCidFromUrl(`?play=${CID}&play=${'b'.repeat(40)}`),
    CID);
});

test('tolerates extra unrelated params around the cid', () => {
  assert.equal(extractPlayCidFromUrl(`?foo=1&play=${CID}&bar=2`), CID);
});
