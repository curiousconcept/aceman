import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropdownKeyAction } from '../lib/dropdown_keys.js';

test('arrow keys open a closed listbox', () => {
  assert.deepEqual(dropdownKeyAction('ArrowDown', false), { action: 'open', preventDefault: true });
  assert.deepEqual(dropdownKeyAction('ArrowUp', false), { action: 'open', preventDefault: true });
});

test('arrow keys move focus when open, with direction', () => {
  assert.deepEqual(dropdownKeyAction('ArrowDown', true), { action: 'move', dir: 1, preventDefault: true });
  assert.deepEqual(dropdownKeyAction('ArrowUp', true), { action: 'move', dir: -1, preventDefault: true });
});

test('Enter / Space open when closed, select when open', () => {
  for (const k of ['Enter', ' ']) {
    assert.deepEqual(dropdownKeyAction(k, false), { action: 'open', preventDefault: true });
    assert.deepEqual(dropdownKeyAction(k, true), { action: 'select', preventDefault: true });
  }
});

test('Escape closes only when open, and swallows the key only then', () => {
  assert.deepEqual(dropdownKeyAction('Escape', true), { action: 'close', preventDefault: true });
  assert.deepEqual(dropdownKeyAction('Escape', false), { action: 'none', preventDefault: false });
});

test('Tab closes but lets focus move on (no preventDefault)', () => {
  assert.deepEqual(dropdownKeyAction('Tab', true), { action: 'close', preventDefault: false });
  assert.deepEqual(dropdownKeyAction('Tab', false), { action: 'close', preventDefault: false });
});

test('unrelated keys are ignored', () => {
  assert.deepEqual(dropdownKeyAction('a', true), { action: 'none', preventDefault: false });
  assert.deepEqual(dropdownKeyAction('Home', false), { action: 'none', preventDefault: false });
});
