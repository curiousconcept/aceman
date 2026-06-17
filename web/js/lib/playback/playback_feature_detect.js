// Browser feature detection for in-browser playback.
//
// In-browser playback needs both the mpegts.js library (vendored
// under web/vendor/) AND the MediaSource Extensions API. We don't
// poly-fill or fallback — when either is missing, the dropdown
// hides the "This browser tab" choice and we degrade to the
// external-player path.
//
// `globalObj` lets tests pass a stand-in for `window` so the
// predicate can be exercised against any combination of (mpegts
// present? mpegts.isSupported()?) without touching the real page.

export function inBrowserPlaybackSupported(globalObj) {
  const g = globalObj || (typeof window !== 'undefined' ? window : null);
  if (!g) return false;
  const m = g.mpegts;
  if (!m || typeof m.isSupported !== 'function') return false;
  // mpegts.isSupported can throw if MSE is unavailable (e.g. some
  // private-browsing modes). Treat any throw as "not supported"
  // rather than letting it crash the dropdown render.
  try { return !!m.isSupported(); }
  catch (_) { return false; }
}
