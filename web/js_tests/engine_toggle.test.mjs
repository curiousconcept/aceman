// Tests for the engine Start/Stop/Settling… toggle state mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEngineToggle } from '../js/lib/engine_toggle.js';

const HEALTHY = { container: true, up: true };
const DEGRADED = { container: true, up: false };
const DOWN = { container: false, up: false, image_installed: true };
const NO_IMAGE = { container: false, up: false, image_installed: false };

test('healthy → Stop button, ok status', () => {
  const v = describeEngineToggle(HEALTHY, /*settling=*/false);
  assert.equal(v.status, 'running');
  assert.equal(v.statusClass, 'status ok');
  assert.equal(v.button.text, 'Stop');
  assert.equal(v.button.action, 'stop');
  assert.equal(v.button.disabled, false);
  assert.equal(v.button.className, 'danger-outline');
  assert.equal(v.hint.text, '');
});

test('healthy beats settling — the toggle reflects the truth, not the wait', () => {
  // If a poll lands healthy mid-settle, we want the UI to flip
  // back to "running" immediately rather than holding the
  // disabled Settling… button for the rest of the window.
  const v = describeEngineToggle(HEALTHY, true);
  assert.equal(v.button.text, 'Stop');
  assert.equal(v.button.disabled, false);
});

test('degraded (container up, API silent) → Stop still offered', () => {
  // The user needs an affordance to recover from a stuck engine —
  // even if the API is silent, we let them Stop the container.
  const v = describeEngineToggle(DEGRADED);
  assert.equal(v.status, 'container up, API not answering');
  assert.equal(v.statusClass, 'status bad');
  assert.equal(v.button.text, 'Stop');
  assert.equal(v.button.disabled, false);
});

test('settling + container up → restart-in-progress status text', () => {
  const v = describeEngineToggle(DEGRADED, true);
  assert.match(v.status, /restarting… \(container up, API not answering\)/);
  assert.equal(v.button.text, 'Settling…');
  assert.equal(v.button.disabled, true);
  // Action is empty so the click handler refuses to act.
  assert.equal(v.button.action, '');
});

test('settling + container down → simpler "restarting…" status', () => {
  const v = describeEngineToggle(DOWN, true);
  assert.equal(v.status, 'restarting…');
  assert.equal(v.button.text, 'Settling…');
  assert.equal(v.button.disabled, true);
});

test('down + image installed → Start button, enabled', () => {
  const v = describeEngineToggle(DOWN);
  assert.equal(v.status, 'not running');
  assert.equal(v.statusClass, 'status bad');
  assert.equal(v.button.text, 'Start');
  assert.equal(v.button.action, 'start');
  assert.equal(v.button.className, 'primary');
  assert.equal(v.button.disabled, false);
  assert.equal(v.hint.text, '');
});

test('down + image NOT installed → Start disabled with guidance hint', () => {
  const v = describeEngineToggle(NO_IMAGE);
  assert.equal(v.button.text, 'Start');
  assert.equal(v.button.disabled, true);
  assert.equal(v.hint.text, 'engine image not installed');
  assert.equal(v.hint.className, 'gate-hint warn');
});

test('null status → treated as down without image', () => {
  // A failed /api/engine/status poll shouldn't crash the renderer.
  // The defaults steer the user to "not running, click Start" —
  // the next poll will refine the picture.
  const v = describeEngineToggle(null);
  assert.equal(v.status, 'not running');
  assert.equal(v.button.text, 'Start');
});

test('frozen button/hint constants — callers cannot mutate shared singletons', () => {
  const v = describeEngineToggle(HEALTHY);
  assert.throws(() => { v.button.disabled = true; });
  assert.throws(() => { v.hint.text = 'whatever'; });
});

test('image_installed = undefined → Start enabled (only the explicit false gates)', () => {
  // The broker omits image_installed when it can't probe the
  // image (e.g. podman not installed yet). We must NOT lock the
  // button in that case — let the user try and see the real error.
  const v = describeEngineToggle({ container: false, up: false });
  assert.equal(v.button.disabled, false);
});
