// Pure helpers for the in-tab live-playback pre-roll buffer.
//
// The in-tab mpegts.js player normally starts as soon as the first
// frames decode, leaving it pinned to the live edge with no cushion —
// one engine/network hiccup and the SourceBuffer underruns and the
// video stalls. The Player card's "Buffer" slider lets the user trade
// latency for resilience: hold playback paused until N seconds of
// media are buffered ahead of the playhead, then release. Because the
// engine feeds at ~1x realtime and we leave mpegts.js' live-latency
// chasing off, that N-second head start persists for the life of the
// stream rather than being chased back to the edge.
//
// 0 (the default) means the feature is OFF — play immediately, exactly
// as before. These helpers are pure: bufferedAhead() reads a
// TimeRanges-shaped object {length, end(i)} but touches no real DOM,
// so the gating policy is exercised by deterministic unit tests.

export const BUFFER_MIN = 0;
export const BUFFER_MAX = 60;

// Normalise an arbitrary stored string / slider value to an integer in
// [0, 60]. NaN, null, junk → 0 (disabled), so a corrupt localStorage
// entry degrades to "off" rather than throwing at play time.
export function clampBuffer(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return BUFFER_MIN;
  if (n < BUFFER_MIN) return BUFFER_MIN;
  if (n > BUFFER_MAX) return BUFFER_MAX;
  return n;
}

// Seconds of media buffered ahead of the current playhead. Reads a
// TimeRanges-shaped object and currentTime; 0 when nothing is buffered.
// We measure from the last range's end so a stale range before the
// playhead can't inflate the figure.
export function bufferedAhead(buffered, currentTime) {
  if (!buffered || !buffered.length) return 0;
  const end = buffered.end(buffered.length - 1);
  const ahead = end - (currentTime || 0);
  return ahead > 0 ? ahead : 0;
}

// Has enough buffered to release playback? Feature off (target <= 0)
// is always ready, so callers can route both cases through one check.
export function bufferReady(buffered, currentTime, target) {
  if (target <= 0) return true;
  return bufferedAhead(buffered, currentTime) >= target;
}

// Human label for the slider's live read-out: "Off" at 0, else "N s".
export function bufferLabel(value) {
  const n = clampBuffer(value);
  return n === 0 ? 'Off' : `${n} s`;
}
