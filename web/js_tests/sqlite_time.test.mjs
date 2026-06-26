// Tests for the SQLite-UTC → local timestamp formatter.
//
// We pin the timezone to UTC so "local" == "UTC" and the converted
// values are deterministic regardless of where the suite runs. Node
// honours a runtime change to process.env.TZ for subsequent Date ops.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSqliteUtcToLocal } from '../js/domains/history/lib/sqlite_time.js';

test('empty / missing → empty string', () => {
  assert.equal(formatSqliteUtcToLocal(''), '');
  assert.equal(formatSqliteUtcToLocal(null), '');
  assert.equal(formatSqliteUtcToLocal(undefined), '');
});

test('valid UTC stamp → "YYYY-MM-DD HH:MM" (TZ=UTC)', () => {
  assert.equal(formatSqliteUtcToLocal('2026-06-25 14:30:00'), '2026-06-25 14:30');
});

test('zero-pads single-digit month / day / hour / minute', () => {
  assert.equal(formatSqliteUtcToLocal('2026-01-05 04:09:00'), '2026-01-05 04:09');
});

test('drops the seconds component', () => {
  assert.equal(formatSqliteUtcToLocal('2026-12-31 23:59:59'), '2026-12-31 23:59');
});

test('unparseable stamp → first 16 chars of the raw value (no "Invalid Date")', () => {
  assert.equal(formatSqliteUtcToLocal('not a date at all'), 'not a date at al');
  assert.equal(formatSqliteUtcToLocal('garbage'), 'garbage');
});

test('output always matches the YYYY-MM-DD HH:MM shape for real stamps', () => {
  assert.match(formatSqliteUtcToLocal('2026-06-25 14:30:00'),
               /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
});

test('non-string stamp is coerced, not crashed on', () => {
  // Defensive: a numeric/typed value shouldn't throw inside .replace().
  assert.doesNotThrow(() => formatSqliteUtcToLocal(20260625));
});
