// Tests for the playback-target encoding helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTarget, parseTarget, isExternal, isBrowser, isBareBrowser,
} from '../js/lib/playback_target.js';

test('encodeTarget — browser with no name → bare "browser"', () => {
  assert.equal(encodeTarget('browser', '', ''), 'browser');
  assert.equal(encodeTarget('browser', null, null), 'browser');
});

test('encodeTarget — external with no name → empty (no default known)', () => {
  // External targets MUST identify a player; the empty string flips
  // the Play button into a disabled state in the UI rather than
  // launching a half-formed acestream:// dispatch.
  assert.equal(encodeTarget('external', '', ''), '');
});

test('encodeTarget — browser with name + source', () => {
  assert.equal(encodeTarget('browser', 'firefox', 'flatpak'),
               'browser|firefox|flatpak');
});

test('encodeTarget — external with name + source', () => {
  assert.equal(encodeTarget('external', 'vlc', 'system'),
               'external|vlc|system');
});

test('encodeTarget — missing source defaults to empty', () => {
  assert.equal(encodeTarget('external', 'mpv'), 'external|mpv|');
});

test('encodeTarget — unknown kind throws', () => {
  assert.throws(() => encodeTarget('rogue', 'x', 'y'), /unknown kind/);
});

test('parseTarget — bare "browser"', () => {
  assert.deepEqual(parseTarget('browser'),
                   { kind: 'browser', name: '', source: '' });
});

test('parseTarget — empty / falsey → all-empty', () => {
  assert.deepEqual(parseTarget(''),
                   { kind: '', name: '', source: '' });
  assert.deepEqual(parseTarget(null),
                   { kind: '', name: '', source: '' });
  assert.deepEqual(parseTarget(undefined),
                   { kind: '', name: '', source: '' });
});

test('parseTarget — external|name|source', () => {
  assert.deepEqual(parseTarget('external|vlc|system'),
                   { kind: 'external', name: 'vlc', source: 'system' });
});

test('parseTarget — browser|name|source', () => {
  assert.deepEqual(parseTarget('browser|firefox|flatpak'),
                   { kind: 'browser', name: 'firefox', source: 'flatpak' });
});

test('parseTarget — unknown kind → all-empty (refused, not crashed)', () => {
  // Defends the UI from any injected target string that doesn't
  // start with one of our two whitelisted kinds.
  assert.deepEqual(parseTarget('shellcmd|rm|-rf'),
                   { kind: '', name: '', source: '' });
});

test('parseTarget — missing source segment tolerated', () => {
  assert.deepEqual(parseTarget('external|mpv'),
                   { kind: 'external', name: 'mpv', source: '' });
});

test('isExternal / isBrowser / isBareBrowser predicates', () => {
  assert.equal(isExternal('external|vlc|system'), true);
  assert.equal(isExternal('browser|firefox|'), false);
  assert.equal(isBrowser('browser|firefox|'), true);
  assert.equal(isBrowser('external|vlc|'), false);
  assert.equal(isBareBrowser('browser'), true);
  assert.equal(isBareBrowser('browser|firefox|'), false);
  assert.equal(isBareBrowser(''), false);
});

test('round-trip encode/parse for both kinds', () => {
  const cases = [
    ['browser', 'firefox', 'flatpak'],
    ['external', 'mpv', 'system'],
    ['external', 'vlc', ''],
  ];
  for (const [kind, name, source] of cases) {
    const enc = encodeTarget(kind, name, source);
    const dec = parseTarget(enc);
    assert.equal(dec.kind, kind);
    assert.equal(dec.name, name);
    assert.equal(dec.source, source);
  }
});
