// Tests for the external-player display-label helpers.

import test from 'node:test';
import assert from 'node:assert/strict';

import { playerLabel, sourceLabel } from '../domains/playback/lib/players.js';

test('playerLabel maps known players to brand-correct labels', () => {
  assert.equal(playerLabel('vlc'), 'VLC');
  assert.equal(playerLabel('mpv'), 'MPV');
});

test('playerLabel shows an unrecognised player as detected (display as-is)', () => {
  assert.equal(playerLabel('totem'), 'totem');
  assert.equal(playerLabel('SMPlayer'), 'SMPlayer');
});

test('playerLabel tolerates empty / missing input', () => {
  assert.equal(playerLabel(''), '');
  assert.equal(playerLabel(undefined), '');
});

test('sourceLabel capitalises the install source', () => {
  assert.equal(sourceLabel('system'), 'System');
  assert.equal(sourceLabel('flatpak'), 'Flatpak');
});

test('sourceLabel tolerates empty / missing input', () => {
  assert.equal(sourceLabel(''), '');
  assert.equal(sourceLabel(undefined), '');
});
