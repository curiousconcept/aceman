// Tests for the dropdown-value → /api/config payload mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { targetValueToConfig } from '../js/domains/playback/lib/playback_config.js';

test('bare "browser" → in-tab mode, no specific browser pinned', () => {
  assert.deepEqual(targetValueToConfig('browser'), {
    playback_mode: 'browser',
    default_browser: '',
    default_browser_source: '',
  });
});

test('browser|name|source → browser mode with pinned browser', () => {
  assert.deepEqual(targetValueToConfig('browser|firefox|flatpak'), {
    playback_mode: 'browser',
    default_browser: 'firefox',
    default_browser_source: 'flatpak',
  });
});

test('browser|name with no source segment → empty source', () => {
  assert.deepEqual(targetValueToConfig('browser|firefox'), {
    playback_mode: 'browser',
    default_browser: 'firefox',
    default_browser_source: '',
  });
});

test('external|name|source → external mode with pinned player', () => {
  assert.deepEqual(targetValueToConfig('external|vlc|system'), {
    playback_mode: 'external',
    default_player: 'vlc',
    default_player_source: 'system',
  });
});

test('external|name with no source segment → empty source', () => {
  assert.deepEqual(targetValueToConfig('external|mpv'), {
    playback_mode: 'external',
    default_player: 'mpv',
    default_player_source: '',
  });
});

test('empty / unknown value → external mode with empty defaults', () => {
  // Anything that does not start with "browser" collapses to
  // external. The launcher then refuses to fire without a chosen
  // player, which is correct: we never silently pick one.
  assert.deepEqual(targetValueToConfig(''), {
    playback_mode: 'external',
    default_player: '',
    default_player_source: '',
  });
});

test('unknown kind|… → external (defends against injection)', () => {
  // If a future option somehow stuffs an unknown prefix into the
  // <option value>, we must NOT silently map it to "browser".
  assert.equal(targetValueToConfig('shell|rm|-rf').playback_mode,
               'external');
});

test('null / undefined → external defaults (no crash)', () => {
  assert.equal(targetValueToConfig(null).playback_mode, 'external');
  assert.equal(targetValueToConfig(undefined).playback_mode, 'external');
});
