// Tests for the Play/Stop button state mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describePlayButton } from '../domains/playback/lib/play_stop_button.js';

test('idle → ▶ with Play title and aria-label, no .playing class', () => {
  const v = describePlayButton(false);
  assert.equal(v.text, '▶');
  assert.equal(v.title, 'Play');
  assert.equal(v.ariaLabel, 'Play');
  assert.equal(v.playingClass, false);
});

test('playing → ⏹ with Stop title and aria-label, .playing class added', () => {
  const v = describePlayButton(true);
  assert.equal(v.text, '⏹');
  assert.equal(v.title, 'Stop');
  assert.equal(v.ariaLabel, 'Stop');
  assert.equal(v.playingClass, true);
});

test('title and aria-label stay in sync — pinned so the screen reader matches the tooltip', () => {
  // Pre-empts an accidental refactor where the title changes but
  // aria-label doesn't, leaving a screen-reader user with stale
  // info while sighted users see the new label.
  assert.equal(describePlayButton(true).title,
               describePlayButton(true).ariaLabel);
  assert.equal(describePlayButton(false).title,
               describePlayButton(false).ariaLabel);
});

test('truthy / falsy coercion', () => {
  // Caller passes whatever they have; we should treat truthy as
  // "playing", falsy as "idle", consistently.
  assert.equal(describePlayButton(undefined).playingClass, false);
  assert.equal(describePlayButton(null).playingClass, false);
  assert.equal(describePlayButton('').playingClass, false);
  assert.equal(describePlayButton('browser').playingClass, true);
  assert.equal(describePlayButton(1).playingClass, true);
});
