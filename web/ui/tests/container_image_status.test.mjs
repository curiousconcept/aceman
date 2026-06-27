// Tests for the engine-image status → display-fields mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeContainerImageStatus } from '../domains/image/lib/container_image_status.js';

test('null input → unavailable card (e.g. fetch failed)', () => {
  const v = describeContainerImageStatus(null);
  assert.equal(v.status, 'unavailable');
  assert.equal(v.statusClass, 'status bad');
  assert.equal(v.installButton.disabled, true);
  assert.equal(v.uninstallEnabled, false);
  assert.equal(v.log.visible, false);
  assert.equal(v.pollAgain, false);
});

test('building → expanded log, both buttons disabled, polling on', () => {
  const v = describeContainerImageStatus({
    state: 'building',
    installed: false,
    tag: 'localhost/acestream:vetted',
    log_tail: ['STEP 1', 'STEP 2'],
  });
  assert.equal(v.status, 'building…');
  assert.equal(v.installButton.text, 'Building…');
  assert.equal(v.installButton.disabled, true);
  assert.equal(v.uninstallEnabled, false);
  assert.equal(v.log.visible, true);
  assert.equal(v.log.expanded, true);
  assert.deepEqual(v.log.lines, ['STEP 1', 'STEP 2']);
  assert.equal(v.pollAgain, true);
});

test('installed → Rebuild + Uninstall enabled, log collapsed when present', () => {
  const v = describeContainerImageStatus({
    state: 'idle', installed: true,
    log_tail: ['build OK'],
  });
  assert.equal(v.status, 'installed');
  assert.equal(v.statusClass, 'status ok');
  assert.equal(v.installButton.text, 'Rebuild');
  assert.equal(v.installButton.disabled, false);
  assert.equal(v.uninstallEnabled, true);
  assert.equal(v.log.visible, true);
  assert.equal(v.log.expanded, false);
  assert.equal(v.pollAgain, false);
});

test('installed with no log → log card hidden', () => {
  const v = describeContainerImageStatus({ state: 'idle', installed: true });
  assert.equal(v.log.visible, false);
});

test('not installed → Install enabled, Uninstall disabled', () => {
  const v = describeContainerImageStatus({ state: 'idle', installed: false });
  assert.equal(v.status, 'not installed');
  assert.equal(v.statusClass, 'status bad');
  assert.equal(v.installButton.text, 'Install');
  assert.equal(v.installButton.disabled, false);
  assert.equal(v.uninstallEnabled, false);
});

test('errorHint surfaces s.error when present (not building)', () => {
  const v = describeContainerImageStatus({
    state: 'idle', installed: false, error: 'engine.tar.gz missing',
  });
  assert.equal(v.errorHint, 'engine.tar.gz missing');
});

test('errorHint blank while building (the log carries that info)', () => {
  const v = describeContainerImageStatus({
    state: 'building', installed: false, error: 'transient', log_tail: [],
  });
  assert.equal(v.errorHint, '');
});

test('missing log_tail defaults to empty lines (no crash)', () => {
  const v = describeContainerImageStatus({ state: 'idle', installed: true });
  assert.deepEqual(v.log.lines, []);
});

test('building with no log_tail still yields empty lines (no crash)', () => {
  // Exercises the building-branch `s.log_tail || []` fallback arm —
  // a build can report state before the first log line lands.
  const v = describeContainerImageStatus({ state: 'building', installed: false });
  assert.equal(v.status, 'building…');
  assert.deepEqual(v.log.lines, []);
  assert.equal(v.log.expanded, true);
});

test('UNAVAILABLE result is frozen — caller mutations cannot leak', () => {
  // The mapping reuses one static object for the unavailable case;
  // freezing it stops a caller from accidentally toggling
  // uninstallEnabled etc. through their own write.
  const v = describeContainerImageStatus(null);
  assert.throws(() => { v.uninstallEnabled = true; });
});
