// Tests for the daysSinceLabel formatter.
//
// We inject `now` rather than letting the function read the wall
// clock, so the buckets ("yesterday", "3d ago", "2mo ago", "1y ago")
// are exercised deterministically.

import test from 'node:test';
import assert from 'node:assert/strict';
import { daysSinceLabel } from '../js/domains/favourites/lib/last_watched_label.js';

const NOW = Date.parse('2026-06-15T12:00:00Z');

test('null/empty stamp → never watched', () => {
  assert.equal(daysSinceLabel(null, NOW), 'never watched');
  assert.equal(daysSinceLabel('', NOW), 'never watched');
  assert.equal(daysSinceLabel(undefined, NOW), 'never watched');
});

test('invalid stamp → empty string (no crash, no label)', () => {
  assert.equal(daysSinceLabel('not a date', NOW), '');
});

test('0 days → watched today', () => {
  assert.equal(daysSinceLabel('2026-06-15 11:00:00', NOW), 'watched today');
});

test('1 day → yesterday', () => {
  assert.equal(daysSinceLabel('2026-06-14 12:00:00', NOW), 'yesterday');
});

test('3 days → "3d ago"', () => {
  assert.equal(daysSinceLabel('2026-06-12 12:00:00', NOW), '3d ago');
});

test('60 days → "2mo ago"', () => {
  assert.equal(daysSinceLabel('2026-04-16 12:00:00', NOW), '2mo ago');
});

test('400 days → "1y ago"', () => {
  assert.equal(daysSinceLabel('2025-05-11 12:00:00', NOW), '1y ago');
});

test('full ISO with Z is parsed correctly', () => {
  assert.equal(daysSinceLabel('2026-06-14T12:00:00.000Z', NOW), 'yesterday');
});

test('full ISO with +HH:MM offset is parsed correctly', () => {
  // 2026-06-14T14:00:00+02:00 == 2026-06-14T12:00:00Z → yesterday
  assert.equal(daysSinceLabel('2026-06-14T14:00:00+02:00', NOW), 'yesterday');
});
