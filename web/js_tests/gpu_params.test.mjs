// Tests for the GPU query-string builder.
//
// This is the branchiest piece of the GPU card — backend precedence
// (nvidia > qsv > vaapi) and the H.264-encode gate — and it had ZERO
// coverage while it lived inline in app.js. Every path is pinned here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuQueryParams } from '../js/domains/gpu/lib/gpu_params.js';

const ALL_ON = { encode: true, deinterlace: true, scale: '1080' };

test('null / unavailable caps → empty string', () => {
  assert.equal(gpuQueryParams(null, ALL_ON), '');
  assert.equal(gpuQueryParams(undefined, ALL_ON), '');
  assert.equal(gpuQueryParams({ available: false, nvidia: true }, ALL_ON), '');
});

test('available but nothing enabled → empty string', () => {
  const caps = { available: true, nvidia: true };
  assert.equal(gpuQueryParams(caps, {}), '');
  assert.equal(gpuQueryParams(caps, { encode: false, deinterlace: false, scale: '' }), '');
  assert.equal(gpuQueryParams(caps, undefined), '');
});

test('available with no usable backend → empty string', () => {
  // available:true but neither nvidia nor vaapi present (shouldn't
  // happen from the probe, but the gate must hold).
  const caps = { available: true, nvidia: false, vaapi: null };
  assert.equal(gpuQueryParams(caps, ALL_ON), '');
});

test('nvidia: encode always allowed (h264 implicit)', () => {
  const caps = { available: true, nvidia: true };
  assert.equal(gpuQueryParams(caps, { encode: true }),
               '&gpu_backend=nvidia&gpu_enc=1');
});

test('vaapi without qsv → vaapi backend', () => {
  const caps = { available: true, vaapi: { h264_enc: true } };
  assert.equal(gpuQueryParams(caps, { encode: true }),
               '&gpu_backend=vaapi&gpu_enc=1');
});

test('vaapi with qsv → qsv backend', () => {
  const caps = { available: true, qsv: true, vaapi: { h264_enc: true } };
  assert.equal(gpuQueryParams(caps, { encode: true }),
               '&gpu_backend=qsv&gpu_enc=1');
});

test('backend precedence: nvidia beats qsv/vaapi', () => {
  const caps = { available: true, nvidia: true, qsv: true,
                 vaapi: { h264_enc: true } };
  assert.match(gpuQueryParams(caps, { encode: true }), /gpu_backend=nvidia/);
});

test('vaapi without H.264 encode → encode flag suppressed', () => {
  // The card disables the encode checkbox in this case, but if a stale
  // setting still has encode:true the param builder must not emit
  // gpu_enc=1 against a backend that can't encode H.264.
  const caps = { available: true, vaapi: { h264_enc: false } };
  assert.equal(gpuQueryParams(caps, { encode: true }), '&gpu_backend=vaapi');
  // …but filters (deinterlace/scale) still apply on that backend.
  assert.equal(gpuQueryParams(caps, { encode: true, deinterlace: true }),
               '&gpu_backend=vaapi&gpu_dei=1');
});

test('deinterlace-only enables the backend + dei flag, no enc', () => {
  const caps = { available: true, nvidia: true };
  assert.equal(gpuQueryParams(caps, { deinterlace: true }),
               '&gpu_backend=nvidia&gpu_dei=1');
});

test('scale value is interpolated into the param', () => {
  const caps = { available: true, nvidia: true };
  assert.equal(gpuQueryParams(caps, { scale: '2160' }),
               '&gpu_backend=nvidia&gpu_scale=2160');
});

test('all three flags compose in a stable order', () => {
  const caps = { available: true, nvidia: true };
  assert.equal(gpuQueryParams(caps, ALL_ON),
               '&gpu_backend=nvidia&gpu_enc=1&gpu_dei=1&gpu_scale=1080');
});
