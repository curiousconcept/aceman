// Tests for the playback-target option-list builder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaybackOptions } from '../domains/playback/lib/playback_options.js';

const FF = { name: 'firefox', source: 'system' };
const FF_FLATPAK = { name: 'firefox', source: 'flatpak' };
const CHROME = { name: 'google-chrome', source: 'system' };
const VLC = { name: 'vlc', source: 'system' };
const VLC_FLATPAK = { name: 'vlc', source: 'flatpak' };
const MPV = { name: 'mpv', source: 'system' };
const MPV_FLATPAK = { name: 'mpv', source: 'flatpak' };

test('default state — only "This Tab" with no browser sniff', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: true,
  });
  assert.equal(v.groups.length, 1);
  assert.equal(v.groups[0].label, null);
  assert.deepEqual(v.groups[0].options, [{
    value: 'browser',
    text: 'This Tab',
    disabled: false,
  }]);
  assert.equal(v.hasAnyTarget, true);
});

test('"This Tab" label is the same regardless of currentBrowser', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: 'firefox', showAll: false, inBrowserSupported: true,
  });
  assert.equal(v.groups[0].options[0].text, 'This Tab');
});

test('"This Tab" label is the same with showAll on', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: 'firefox', showAll: true, inBrowserSupported: true,
  });
  assert.equal(v.groups[0].options[0].text, 'This Tab');
});

test('"This Tab" is disabled with a helpful suffix when MSE missing', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.groups[0].options[0].disabled, true);
  assert.match(v.groups[0].options[0].text, /unsupported/);
});

test('Other-browsers group skips entries matching current browser', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [],
    detectedBrowsers: [FF, FF_FLATPAK, CHROME],
    currentBrowser: 'firefox',
    showAll: false,
    inBrowserSupported: true,
  });
  // Both firefox entries (system + flatpak) are hidden — UA can't
  // tell them apart, so we hide both not just one.
  const others = v.groups.find(g => g.label === 'Other Browsers');
  assert.ok(others, 'an Other Browsers group is present');
  assert.equal(others.options.length, 1);
  assert.equal(others.options[0].value, 'browser|google-chrome|system');
  assert.equal(others.options[0].text, 'Google Chrome (System)');
});

test('"Show all" reveals every detected browser install', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [],
    detectedBrowsers: [FF, FF_FLATPAK, CHROME],
    currentBrowser: 'firefox',
    showAll: true,
    inBrowserSupported: true,
  });
  const others = v.groups.find(g => g.label === 'Other Browsers');
  assert.equal(others.options.length, 3);
  assert.deepEqual(
    others.options.map(o => o.value),
    ['browser|firefox|system', 'browser|firefox|flatpak',
     'browser|google-chrome|system']);
});

test('External Players group uses external|name|source encoding', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [VLC, MPV],
    detectedBrowsers: [],
    currentBrowser: '',
    showAll: false,
    inBrowserSupported: true,
  });
  const ext = v.groups.find(g => g.label === 'External Players');
  assert.deepEqual(ext.options, [
    { value: 'external|vlc|system', text: 'VLC (System)', disabled: false },
    { value: 'external|mpv|system', text: 'MPV (System)', disabled: false },
  ]);
});

test('Other-browsers / External-players groups omitted when empty', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: true,
  });
  assert.equal(v.groups.length, 1, 'only the "This Tab" group');
});

test('No usable target anywhere → hasAnyTarget false + a guidance hint', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.hasAnyTarget, false);
  assert.match(v.hintMessage, /No playback target available/);
});

test('hasAnyTarget true when an external player exists, even if no MSE', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [VLC], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.hasAnyTarget, true);
  assert.equal(v.hintMessage, '');
});

test('hasAnyTarget true when ONLY a non-current detected browser exists', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [CHROME],
    currentBrowser: 'firefox', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.hasAnyTarget, true);
});

test('zero-arg call defaults to no targets — does not crash', () => {
  const v = buildPlaybackOptions();
  assert.equal(v.hasAnyTarget, false);
  // "This Tab" is still there, disabled, with the unsupported tail.
  assert.equal(v.groups[0].options[0].disabled, true);
});

test('duplicate players deduped by name when showAll=false', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [VLC, VLC_FLATPAK, MPV, MPV_FLATPAK],
    detectedBrowsers: [],
    currentBrowser: '',
    showAll: false,
    inBrowserSupported: true,
  });
  const ext = v.groups.find(g => g.label === 'External Players');
  assert.equal(ext.options.length, 2, 'one entry per player name');
  assert.equal(ext.options[0].value, 'external|vlc|system');
  assert.equal(ext.options[1].value, 'external|mpv|system');
});

test('showAll=true reveals every player install including duplicates', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [VLC, VLC_FLATPAK, MPV],
    detectedBrowsers: [],
    currentBrowser: '',
    showAll: true,
    inBrowserSupported: true,
  });
  const ext = v.groups.find(g => g.label === 'External Players');
  assert.equal(ext.options.length, 3);
  assert.deepEqual(
    ext.options.map(o => o.value),
    ['external|vlc|system', 'external|vlc|flatpak', 'external|mpv|system'],
  );
});
