import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../domains/container-memory/lib/format_bytes.js';

test('bytes under 1 KiB stay in B', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1023), '1023 B');
});

test('KiB and MiB round to whole units', () => {
  assert.equal(formatBytes(1024), '1 KiB');
  assert.equal(formatBytes(1536), '2 KiB');
  assert.equal(formatBytes(1024 ** 2), '1 MiB');
  assert.equal(formatBytes(100 * 1024 ** 2), '100 MiB');
});

test('GiB keeps two decimals', () => {
  assert.equal(formatBytes(1024 ** 3), '1.00 GiB');
  assert.equal(formatBytes(2.5 * 1024 ** 3), '2.50 GiB');
});
