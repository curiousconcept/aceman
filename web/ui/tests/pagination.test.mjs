// Tests for the pagination math.

import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../lib/pagination.js';

test('empty list — single empty page, no nav, no label', () => {
  const p = paginate(0, 0, 5);
  assert.equal(p.pageCount, 1);
  assert.equal(p.page, 0);
  assert.equal(p.isEmpty, true);
  assert.equal(p.hasPrev, false);
  assert.equal(p.hasNext, false);
  assert.equal(p.label(), '');
});

test('exact fit — last page is full, no overflow', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const p = paginate(items.length, 0, 5);
  assert.equal(p.pageCount, 1);
  assert.deepEqual(p.slice(items), items);
  assert.equal(p.label(), '1–5 of 5');
});

test('overflow — second page holds the remainder', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const first = paginate(items.length, 0, 5);
  assert.deepEqual(first.slice(items), ['a','b','c','d','e']);
  assert.equal(first.label(), '1–5 of 7');
  assert.equal(first.hasNext, true);
  const second = paginate(items.length, 1, 5);
  assert.deepEqual(second.slice(items), ['f','g']);
  assert.equal(second.label(), '6–7 of 7');
  assert.equal(second.hasPrev, true);
  assert.equal(second.hasNext, false);
});

test('page index clamps when items shrink (stale state)', () => {
  // Caller had page=4 of 5 pages; items shrank to 1 page.
  const p = paginate(3, 4, 5);
  assert.equal(p.page, 0,
    'page index should snap back into the valid range');
});

test('negative or NaN page → 0', () => {
  assert.equal(paginate(10, -1, 5).page, 0);
  assert.equal(paginate(10, NaN, 5).page, 0);
});

test('paginate — invalid page size throws', () => {
  assert.throws(() => paginate(10, 0, 0), /positive number/);
  assert.throws(() => paginate(10, 0, -3), /positive number/);
  assert.throws(() => paginate(10, 0, NaN), /positive number/);
});

test('paginate — fractional total floors safely', () => {
  // Real callers never pass fractional totals, but defending the
  // boundary keeps an upstream bug from corrupting the page label.
  const p = paginate(7.9, 0, 5);
  assert.equal(p.pageCount, 2);
  assert.equal(p.label(), '1–5 of 7');
});
