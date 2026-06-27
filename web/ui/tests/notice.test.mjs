// Tests for the pure top-notice helpers (class + action gate).

import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeClassName, noticeHasAction } from '../lib/notice.js';

test('noticeClassName — no variant → bare "notice"', () => {
  assert.equal(noticeClassName(), 'notice');
  assert.equal(noticeClassName(''), 'notice');
  assert.equal(noticeClassName(null), 'notice');
  assert.equal(noticeClassName(undefined), 'notice');
});

test('noticeClassName — variant → BEM modifier appended', () => {
  assert.equal(noticeClassName('danger'), 'notice notice--danger');
  assert.equal(noticeClassName('go'), 'notice notice--go');
});

test('noticeHasAction — true only with a label AND a function', () => {
  assert.equal(noticeHasAction('Restart', () => {}), true);
});

test('noticeHasAction — missing label → false', () => {
  assert.equal(noticeHasAction('', () => {}), false);
  assert.equal(noticeHasAction(null, () => {}), false);
  assert.equal(noticeHasAction(undefined, () => {}), false);
});

test('noticeHasAction — missing / non-function handler → false', () => {
  assert.equal(noticeHasAction('Restart', null), false);
  assert.equal(noticeHasAction('Restart', undefined), false);
  assert.equal(noticeHasAction('Restart', 'not-a-fn'), false);
  assert.equal(noticeHasAction('Restart', 42), false);
});

test('noticeHasAction — returns a real boolean (not a truthy value)', () => {
  assert.strictEqual(noticeHasAction('x', () => {}), true);
  assert.strictEqual(noticeHasAction('', null), false);
});
