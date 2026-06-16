// Tests for the favourite-name helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueFavName, pickFavName } from '../js/lib/favnames.js';

test('uniqueFavName — passes through a clean unused label', () => {
  assert.equal(uniqueFavName('My channel', []), 'My channel');
});

test('uniqueFavName — collapses inner whitespace + trims', () => {
  assert.equal(uniqueFavName('  My   channel \n', []), 'My channel');
});

test('uniqueFavName — empty / whitespace → null', () => {
  assert.equal(uniqueFavName('', []), null);
  assert.equal(uniqueFavName('   ', []), null);
  assert.equal(uniqueFavName(null, []), null);
});

test('uniqueFavName — appends (2) when the base is taken', () => {
  assert.equal(uniqueFavName('Sport', ['Sport']), 'Sport (2)');
});

test('uniqueFavName — walks up to the first free suffix', () => {
  const taken = ['Sport', 'Sport (2)', 'Sport (3)'];
  assert.equal(uniqueFavName('Sport', taken), 'Sport (4)');
});

test('uniqueFavName — caps base length to leave room for suffix', () => {
  const long = 'x'.repeat(200);
  const name = uniqueFavName(long, []);
  assert.ok(name.length <= 124,
    `expected length <= 124, got ${name.length}`);
});

test('pickFavName — prefers translated_name', () => {
  const r = { translated_name: 'English', name: 'Оригинал', cid: 'abc' };
  assert.equal(pickFavName(r, []), 'English');
});

test('pickFavName — falls back to name', () => {
  const r = { name: 'Оригинал', cid: 'abcdef0123456789' };
  assert.equal(pickFavName(r, []), 'Оригинал');
});

test('pickFavName — fabricates ace <cid8> when both labels missing', () => {
  const r = { cid: 'abcdef0123456789cafe' };
  assert.equal(pickFavName(r, []), 'ace abcdef01');
});
