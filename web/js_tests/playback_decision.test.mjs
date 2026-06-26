// Tests for the playback-path decision tree.
//
// This is the same matrix that lived inline in play() — every
// branch here used to be an `if`. The deps map (playback_mode ×
// default_browser × inBrowserSupported) is small enough to
// exhaust, so each test is a single, named cell of that table.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePlaybackPath } from '../js/domains/playback/lib/playback_decision.js';

test('external mode → external-scheme with encoded target', () => {
  const p = decidePlaybackPath({
    playback_mode: 'external',
    default_player: 'vlc',
    default_player_source: 'system',
  }, { inBrowserSupported: true });
  assert.equal(p.kind, 'external-scheme');
  assert.equal(p.target, 'external|vlc|system');
});

test('external mode with no default_player → empty target', () => {
  // encodeTarget('external', '', '') collapses to '' — the launcher
  // will refuse to fire without a chosen player, which is the
  // correct behaviour vs. silently picking one.
  const p = decidePlaybackPath({ playback_mode: 'external' },
                               { inBrowserSupported: false });
  assert.equal(p.kind, 'external-scheme');
  assert.equal(p.target, '');
});

test('browser mode + default_browser → open-in-other-browser', () => {
  const p = decidePlaybackPath({
    playback_mode: 'browser',
    default_browser: 'firefox',
    default_browser_source: 'system',
  }, { inBrowserSupported: true });
  assert.equal(p.kind, 'open-in-other-browser');
  assert.equal(p.browserName, 'firefox');
  assert.equal(p.browserSource, 'system');
  assert.equal(p.label, 'Firefox (system)');
});

test('open-in-other-browser label omits the parenthetical when no source', () => {
  const p = decidePlaybackPath({
    playback_mode: 'browser',
    default_browser: 'google-chrome',
  }, { inBrowserSupported: true });
  assert.equal(p.label, 'Google Chrome');
});

test('browser mode without default_browser + MSE OK → in-tab', () => {
  const p = decidePlaybackPath({ playback_mode: 'browser' },
                               { inBrowserSupported: true });
  assert.equal(p.kind, 'in-tab');
});

test('browser mode without default_browser + MSE missing → fallback', () => {
  const p = decidePlaybackPath({
    playback_mode: 'browser',
    default_player: 'mpv',
    default_player_source: 'system',
  }, { inBrowserSupported: false });
  assert.equal(p.kind, 'in-tab-unsupported-fallback');
  assert.match(p.warning, /mpegts\.js \/ MSE not supported/);
  assert.equal(p.target, 'external|mpv|system');
});

test('default_browser BEATS the unsupported-fallback check', () => {
  // If the user picked a specific browser AND MSE is missing, we
  // still trust their pick — opening Firefox externally is fine
  // even when in-tab is unavailable. This is the same precedence
  // play() always had; pin it so a refactor can't accidentally
  // flip the order.
  const p = decidePlaybackPath({
    playback_mode: 'browser',
    default_browser: 'firefox',
  }, { inBrowserSupported: false });
  assert.equal(p.kind, 'open-in-other-browser');
});

test('null cfg → treated as external mode, empty target', () => {
  const p = decidePlaybackPath(null);
  assert.equal(p.kind, 'external-scheme');
  assert.equal(p.target, '');
});

test('cfg with unknown playback_mode → treated as external', () => {
  // Defensive: an upgrade that adds a new mode without updating
  // this dispatch must NOT silently fall into the in-tab branch.
  const p = decidePlaybackPath({ playback_mode: 'rogue' });
  assert.equal(p.kind, 'external-scheme');
});

test('no second arg → defaults to in-tab unsupported', () => {
  // inBrowserSupported defaults to undefined → falsy → fallback.
  // Confirm so the no-deps shape doesn't accidentally promote to
  // 'in-tab'.
  const p = decidePlaybackPath({ playback_mode: 'browser' });
  assert.equal(p.kind, 'in-tab-unsupported-fallback');
});
