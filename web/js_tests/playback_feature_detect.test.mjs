// Tests for the in-browser-playback feature detector.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inBrowserPlaybackSupported } from '../js/domains/playback/lib/playback_feature_detect.js';

test('mpegts present + isSupported() truthy → true', () => {
  const fakeWindow = { mpegts: { isSupported: () => true } };
  assert.equal(inBrowserPlaybackSupported(fakeWindow), true);
});

test('mpegts present but isSupported() returns false → false', () => {
  const fakeWindow = { mpegts: { isSupported: () => false } };
  assert.equal(inBrowserPlaybackSupported(fakeWindow), false);
});

test('mpegts missing → false (script never loaded)', () => {
  assert.equal(inBrowserPlaybackSupported({}), false);
});

test('mpegts is truthy but lacks isSupported method → false', () => {
  // A half-loaded vendor bundle should NOT promote in-browser
  // playback as available — that would crash later when createPlayer
  // is missing too.
  assert.equal(inBrowserPlaybackSupported({ mpegts: {} }), false);
  assert.equal(inBrowserPlaybackSupported({ mpegts: { isSupported: 'not-a-fn' } }),
               false);
});

test('null / undefined globalObj → false (no crash)', () => {
  assert.equal(inBrowserPlaybackSupported(null), false);
  assert.equal(inBrowserPlaybackSupported(undefined), false);
});

test('falls back to the global window when no arg is passed', () => {
  // Exercises the `typeof window !== "undefined" ? window` arm: in the
  // real page inBrowserPlaybackSupported() is called with no argument
  // and must read the global window.
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const saved = globalThis.window;
  try {
    globalThis.window = { mpegts: { isSupported: () => true } };
    assert.equal(inBrowserPlaybackSupported(), true);
    globalThis.window = { mpegts: {} };
    assert.equal(inBrowserPlaybackSupported(), false);
  } finally {
    if (had) globalThis.window = saved; else delete globalThis.window;
  }
});

test('isSupported throwing is treated as unsupported', () => {
  // Some private-browsing modes block MSE in a way that surfaces
  // as a throw from mpegts.isSupported(). We want a clean false —
  // an uncaught throw during the dropdown render would brick the UI.
  const fakeWindow = {
    mpegts: { isSupported: () => { throw new Error('blocked'); } },
  };
  assert.equal(inBrowserPlaybackSupported(fakeWindow), false);
});
