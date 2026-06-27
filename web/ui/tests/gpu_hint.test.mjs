// Tests for the per-driver "GPU encode unavailable" hint.
//
// The old hint hardcoded mesa-va-drivers (AMD only), which is wrong on
// Intel. The fix branches on the probed driver — pin each branch so the
// advice stays correct per GPU.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuEncodeHint } from '../domains/gpu/lib/gpu_hint.js';

test('Intel iHD → points at the full-codec Intel driver, not mesa', () => {
  const h = gpuEncodeHint('iHD');
  assert.match(h, /intel-media-driver-freeworld/);
  assert.doesNotMatch(h, /mesa-va-drivers\b/);
});

test('AMD radeonsi → points at mesa-va-drivers-freeworld', () => {
  const h = gpuEncodeHint('radeonsi');
  assert.match(h, /mesa-va-drivers-freeworld/);
});

test('unknown / null driver → generic libva-utils advice', () => {
  for (const d of [null, undefined, 'nouveau']) {
    const h = gpuEncodeHint(d);
    assert.match(h, /libva-utils/);
    assert.match(h, /VAEntrypointEncSlice/);
  }
});
