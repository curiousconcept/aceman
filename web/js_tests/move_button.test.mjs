// Tests for the "Move current stream → X" button visibility + label.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMoveButton } from '../js/lib/move_button.js';

test('nothing playing → hidden', () => {
  const v = describeMoveButton('', 'browser', 'This browser tab');
  assert.equal(v.visible, false);
});

test('playing AND destination differs → visible, with destination label', () => {
  const v = describeMoveButton(
    'browser', 'external|vlc|system', 'vlc (system)');
  assert.equal(v.visible, true);
  assert.equal(v.text, 'Move current stream → vlc (system)');
});

test('playing AND destination matches → hidden (would be a no-op)', () => {
  const v = describeMoveButton('browser', 'browser', 'This browser tab');
  assert.equal(v.visible, false);
});

test('empty selectedValue → hidden (defends against an empty dropdown state)', () => {
  const v = describeMoveButton('browser', '', '');
  assert.equal(v.visible, false);
});

test('falls back to raw value when label is empty', () => {
  // Useful when the caller couldn't look up the option label (e.g.
  // the dropdown is mid-render).
  const v = describeMoveButton('browser', 'external|vlc|', '');
  assert.equal(v.visible, true);
  assert.equal(v.text, 'Move current stream → external|vlc|');
});

test('null/undefined input is treated as "nothing playing"', () => {
  assert.equal(describeMoveButton(null, 'x', 'y').visible, false);
  assert.equal(describeMoveButton(undefined, 'x', 'y').visible, false);
});

test('all-zero call → hidden, empty text (no crash)', () => {
  const v = describeMoveButton();
  assert.equal(v.visible, false);
  assert.equal(v.text, '');
});

test('different external destinations across dropdowns', () => {
  // Pin that the comparison is exact-string — a user picking mpv
  // while VLC is playing must surface the move button.
  const v = describeMoveButton(
    'external|vlc|system', 'external|mpv|system', 'mpv (system)');
  assert.equal(v.visible, true);
  assert.match(v.text, /mpv \(system\)/);
});
