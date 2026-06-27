// Tests for the content-id parser. Pure-function unit tests — no DOM,
// no globals, no third-party libraries. Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseId, HEX40 } from '../domains/playback/lib/content_id_parser.js';

const FOURTY = 'a'.repeat(40);

test('parseId — bare 40-hex passes through, lowercased', () => {
  assert.equal(parseId(FOURTY), FOURTY);
  assert.equal(parseId(FOURTY.toUpperCase()), FOURTY);
});

test('parseId — strips acestream:// prefix (case-insensitive)', () => {
  assert.equal(parseId('acestream://' + FOURTY), FOURTY);
  assert.equal(parseId('ACESTREAM://' + FOURTY.toUpperCase()), FOURTY);
});

test('parseId — trims surrounding whitespace', () => {
  assert.equal(parseId('   ' + FOURTY + '\n'), FOURTY);
});

test('parseId — rejects non-hex characters', () => {
  assert.equal(parseId('z'.repeat(40)), null);
  assert.equal(parseId(FOURTY.slice(0, 39) + 'g'), null);
});

test('parseId — rejects wrong-length tokens', () => {
  assert.equal(parseId('a'.repeat(39)), null);
  assert.equal(parseId('a'.repeat(41)), null);
});

test('parseId — rejects empty / nullish input', () => {
  assert.equal(parseId(''), null);
  assert.equal(parseId(null), null);
  assert.equal(parseId(undefined), null);
});

test('HEX40 — anchored at both ends', () => {
  // Pad characters on either side must NOT match — we rely on this
  // to refuse `acestream://CID/extra` injections.
  assert.equal(HEX40.test('x' + FOURTY), false);
  assert.equal(HEX40.test(FOURTY + 'x'), false);
});
