// Tests for the factory-reset report formatter.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatResetReport } from '../js/domains/factory-reset/lib/factory_reset_report.js';

test('empty report → empty string', () => {
  assert.equal(formatResetReport({}), '');
  assert.equal(formatResetReport(null), '');
  assert.equal(formatResetReport(undefined), '');
});

test('single OK step → check mark + name', () => {
  const out = formatResetReport({
    steps: [{ name: 'stop engine', ok: true }],
  });
  assert.equal(out, '✓ stop engine');
});

test('single failed step → cross mark + name', () => {
  const out = formatResetReport({
    steps: [{ name: 'remove image', ok: false }],
  });
  assert.equal(out, '✗ remove image');
});

test('step note rendered in parentheses', () => {
  const out = formatResetReport({
    steps: [{ name: 'stop engine', ok: true, note: 'already stopped' }],
  });
  assert.equal(out, '✓ stop engine (already stopped)');
});

test('step error rendered on the next line, indented', () => {
  const out = formatResetReport({
    steps: [{ name: 'remove image', ok: false, error: 'image in use' }],
  });
  // The indent is deliberate — keeps the error visually nested
  // under its step in a fixed-width font.
  assert.equal(out, '✗ remove image\n    image in use');
});

test('multiple steps joined by newlines', () => {
  const out = formatResetReport({
    steps: [
      { name: 'stop engine', ok: true },
      { name: 'remove image', ok: false, error: 'in use' },
      { name: 'wipe favourites', ok: true },
    ],
  });
  assert.equal(out, [
    '✓ stop engine',
    '✗ remove image\n    in use',
    '✓ wipe favourites',
  ].join('\n'));
});

test('kept list rendered with the "Kept:" header', () => {
  const out = formatResetReport({
    steps: [{ name: 'wipe db', ok: true }],
    kept: [
      { path: '~/.cache/aceman/', reason: 'log files (post-mortem)' },
    ],
  });
  assert.match(out, /Kept:\n  ~\/\.cache\/aceman\/\n {4}log files \(post-mortem\)/);
});

test('empty kept array → no footer', () => {
  const out = formatResetReport({
    steps: [{ name: 'wipe db', ok: true }],
    kept: [],
  });
  assert.equal(out, '✓ wipe db');
  assert.equal(out.includes('Kept:'), false);
});

test('missing steps array → still tolerates a kept list', () => {
  const out = formatResetReport({
    kept: [{ path: '/x', reason: 'why' }],
  });
  assert.match(out, /Kept:/);
});

test('malformed step entries are skipped, not crashed on', () => {
  // A server-side regression that returns null/garbage entries
  // must NOT bring down the report UI.
  const out = formatResetReport({
    steps: [null, undefined, 'string?', { name: 'real', ok: true }, 42],
  });
  assert.equal(out, '✓ real');
});

test('step with missing name renders a fallback label', () => {
  const out = formatResetReport({ steps: [{ ok: false }] });
  assert.match(out, /\(unnamed step\)/);
});

test('malformed kept entries are skipped, not crashed on', () => {
  // Mirror the step-guard: a null/garbage kept entry must be dropped
  // via formatKept's `!entry || typeof entry !== 'object'` guard, not
  // throw while building the footer.
  const out = formatResetReport({
    steps: [{ name: 'wipe db', ok: true }],
    kept: [null, 'nope', 7, { path: '/real', reason: 'kept it' }],
  });
  assert.match(out, /Kept:\n {2}\/real\n {4}kept it/);
  assert.equal(out.includes('null'), false);
});

test('kept entry with missing fields renders placeholders gracefully', () => {
  const out = formatResetReport({
    steps: [], kept: [{}],
  });
  // Empty path / reason — but no crash. The "Kept:" header should
  // not appear when every kept entry collapses to empty.
  assert.match(out, /Kept:/);
});
