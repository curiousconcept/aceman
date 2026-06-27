// Browser identification helpers.
//
// We ship host-side probes for four browsers — Firefox, Chromium,
// Google Chrome, Brave — and the frontend needs to know:
//
//   * which one the user is currently using (so we can label the
//     "Play in" entry "This Firefox tab" instead of the generic),
//   * how to render an internal name as a display label.
//
// The UA-string sniff covers Firefox / Chromium / Google Chrome.
// Brave deliberately hides itself in the UA, so the only reliable
// signal is `navigator.brave.isBrave()` — caller passes that in.
//
// Pure modulo the optional Brave probe. No DOM, no globals.

export const KNOWN_BROWSERS = Object.freeze([
  'firefox', 'brave', 'chromium', 'google-chrome',
]);

const LABELS = Object.freeze({
  firefox: 'Firefox',
  brave: 'Brave',
  chromium: 'Chromium',
  'google-chrome': 'Google Chrome',
});

export function browserLabel(name) {
  return LABELS[name] || name || '';
}

// Pure UA sniff. Returns one of KNOWN_BROWSERS or '' (uncertain).
// Brave is NEVER returned from here — its UA string lies on purpose;
// the caller has to merge in a Brave runtime-API result separately.
export function sniffBrowserFromUA(ua) {
  const s = typeof ua === 'string' ? ua : '';
  if (/\bFirefox\//.test(s)) return 'firefox';
  if (/\bChromium\//.test(s)) return 'chromium';
  if (/\bChrome\//.test(s)) return 'google-chrome';
  return '';
}

// Async detection with injectable dependencies. Production passes
// the real navigator; tests pass a stand-in.
//
//   await detectBrowserFromNav({ userAgent, brave });
//
// `brave` is an object with `.isBrave()` returning a Promise<bool>
// (matches the real navigator.brave shape). If it's absent or
// throws, we fall back to the UA sniff. Returns one of
// KNOWN_BROWSERS or '' (uncertain).
export async function detectBrowserFromNav({ userAgent = '', brave = null } = {}) {
  if (brave && typeof brave.isBrave === 'function') {
    try {
      if (await brave.isBrave()) return 'brave';
    } catch (_) { /* fall through to UA sniff */ }
  }
  return sniffBrowserFromUA(userAgent);
}
