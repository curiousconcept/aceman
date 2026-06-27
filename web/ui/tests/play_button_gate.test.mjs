// Tests for the Play-button enable-gate mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describePlayButtonGate } from '../domains/playback/lib/engine/play_button_gate.js';

test('container + up → enabled, no hint', () => {
  const v = describePlayButtonGate({ container: true, up: true });
  assert.equal(v.disabled, false);
  assert.equal(v.hint.text, '');
});

test('container down + image not installed → disabled, install hint', () => {
  const v = describePlayButtonGate({
    container: false, up: false, image_installed: false,
  });
  assert.equal(v.disabled, true);
  assert.match(v.hint.text, /install the engine image/);
  assert.equal(v.hint.className, 'gate-hint warn');
});

test('container down + image installed → disabled, start hint', () => {
  const v = describePlayButtonGate({
    container: false, up: false, image_installed: true,
  });
  assert.equal(v.disabled, true);
  assert.match(v.hint.text, /engine is not running/);
});

test('phantom up (port answered, container down) → disabled', () => {
  // The strict (container && up) rule prevents starting a stream
  // against an engine we don't actually own. Pin so a future
  // refactor can't accidentally relax to "up || container".
  const v = describePlayButtonGate({ container: false, up: true });
  assert.equal(v.disabled, true);
});

test('phantom container (engine reports container up but API silent) → disabled', () => {
  const v = describePlayButtonGate({ container: true, up: false });
  assert.equal(v.disabled, true);
});

test('null status → disabled, start hint', () => {
  // A failed /api/engine/status poll lands here. Refuse Play
  // until we know the engine is up.
  const v = describePlayButtonGate(null);
  assert.equal(v.disabled, true);
  assert.match(v.hint.text, /not running/);
});

test('image_installed=undefined falls into "engine not running" branch (not install)', () => {
  // The broker may omit image_installed when it can't probe.
  // Don't surface the install hint in that ambiguous case.
  const v = describePlayButtonGate({ container: false, up: false });
  assert.match(v.hint.text, /not running/);
  assert.equal(v.hint.text.includes('install the engine image'), false);
});

test('ALLOWED singleton is frozen — cannot mutate shared default', () => {
  const v = describePlayButtonGate({ container: true, up: true });
  assert.throws(() => { v.disabled = true; });
  assert.throws(() => { v.hint.text = 'pwned'; });
});
