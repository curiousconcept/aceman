// Tests for the in-tab pre-roll buffer policy.
//
// The DOM/timer plumbing (poll the <video>, flip status, call play())
// stays in app.js; the gating arithmetic — clamp the slider value,
// measure buffered-ahead, decide when to release — is pulled in here
// so the edge cases are checked without a real MediaSource.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUFFER_MIN, BUFFER_MAX,
  clampBuffer, bufferedAhead, bufferReady, bufferLabel,
} from '../js/lib/playback/playback_buffer.js';

// TimeRanges stand-in: a list of [start, end] pairs.
function ranges(...pairs) {
  return {
    length: pairs.length,
    start: i => pairs[i][0],
    end: i => pairs[i][1],
  };
}

test('clampBuffer keeps integers inside [0, 60]', () => {
  assert.equal(clampBuffer(0), 0);
  assert.equal(clampBuffer(30), 30);
  assert.equal(clampBuffer(60), 60);
  assert.equal(clampBuffer('15'), 15);
  assert.equal(clampBuffer(12.7), 13);
});

test('clampBuffer floors junk / out-of-range to a safe value', () => {
  assert.equal(clampBuffer(-5), BUFFER_MIN);
  assert.equal(clampBuffer(999), BUFFER_MAX);
  assert.equal(clampBuffer('nope'), 0);
  assert.equal(clampBuffer(null), 0);
  assert.equal(clampBuffer(undefined), 0);
  assert.equal(clampBuffer(NaN), 0);
});

test('bufferedAhead measures from the last range against the playhead', () => {
  assert.equal(bufferedAhead(ranges([0, 10]), 0), 10);
  assert.equal(bufferedAhead(ranges([0, 10]), 4), 6);
  // Stale earlier range is ignored — only the last range's end counts.
  assert.equal(bufferedAhead(ranges([0, 2], [5, 30]), 5), 25);
});

test('bufferedAhead is 0 when nothing buffered or playhead past end', () => {
  assert.equal(bufferedAhead(null, 0), 0);
  assert.equal(bufferedAhead(ranges(), 0), 0);
  assert.equal(bufferedAhead(ranges([0, 5]), 9), 0);
});

test('bufferReady: feature off is always ready', () => {
  assert.equal(bufferReady(ranges(), 0, 0), true);
  assert.equal(bufferReady(null, 0, 0), true);
});

test('bufferReady: gated until the target is reached', () => {
  assert.equal(bufferReady(ranges([0, 4]), 0, 5), false);
  assert.equal(bufferReady(ranges([0, 5]), 0, 5), true);
  assert.equal(bufferReady(ranges([0, 9]), 0, 5), true);
});

test('bufferLabel reads Off at zero, "N s" otherwise', () => {
  assert.equal(bufferLabel(0), 'Off');
  assert.equal(bufferLabel(1), '1 s');
  assert.equal(bufferLabel(60), '60 s');
  assert.equal(bufferLabel(-3), 'Off');
});
