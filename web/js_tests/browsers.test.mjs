// Tests for the browser-identification helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_BROWSERS, browserLabel,
  sniffBrowserFromUA, detectCurrentBrowser,
} from '../js/lib/browsers.js';

test('KNOWN_BROWSERS is frozen and covers the four shipped probes', () => {
  assert.deepEqual([...KNOWN_BROWSERS].sort(),
    ['brave', 'chromium', 'firefox', 'google-chrome']);
  assert.throws(() => { KNOWN_BROWSERS.push('safari'); });
});

test('browserLabel — known names map to display strings', () => {
  assert.equal(browserLabel('firefox'), 'Firefox');
  assert.equal(browserLabel('brave'), 'Brave');
  assert.equal(browserLabel('chromium'), 'Chromium');
  assert.equal(browserLabel('google-chrome'), 'Google Chrome');
});

test('browserLabel — unknown name passes through', () => {
  assert.equal(browserLabel('palemoon'), 'palemoon');
});

test('browserLabel — empty / nullish → empty string', () => {
  assert.equal(browserLabel(''), '');
  assert.equal(browserLabel(null), '');
  assert.equal(browserLabel(undefined), '');
});

const UA = {
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0',
  chromium: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/120.0.6099.71 Chrome/120.0.6099.71 Safari/537.36',
  chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Brave's UA is indistinguishable from Chrome — the *whole point*
  // of having a separate `navigator.brave` API.
  brave: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

test('sniffBrowserFromUA — Firefox', () => {
  assert.equal(sniffBrowserFromUA(UA.firefox), 'firefox');
});

test('sniffBrowserFromUA — Chromium beats the generic Chrome check', () => {
  // Chromium's UA contains BOTH `Chromium/x` and `Chrome/x`; the
  // policy is "prefer the more specific token".
  assert.equal(sniffBrowserFromUA(UA.chromium), 'chromium');
});

test('sniffBrowserFromUA — plain Chrome → google-chrome', () => {
  assert.equal(sniffBrowserFromUA(UA.chrome), 'google-chrome');
});

test('sniffBrowserFromUA — Brave UA reports as google-chrome (by design)', () => {
  // The Brave runtime API is the only honest signal — UA alone must
  // never name Brave, or we'd false-positive on regular Chrome users.
  assert.equal(sniffBrowserFromUA(UA.brave), 'google-chrome');
});

test('sniffBrowserFromUA — Safari is not one of the four → empty', () => {
  assert.equal(sniffBrowserFromUA(UA.safari), '');
});

test('sniffBrowserFromUA — non-string / empty → empty', () => {
  assert.equal(sniffBrowserFromUA(null), '');
  assert.equal(sniffBrowserFromUA(undefined), '');
  assert.equal(sniffBrowserFromUA(123), '');
  assert.equal(sniffBrowserFromUA(''), '');
});

test('detectCurrentBrowser — Brave probe returns true → brave', async () => {
  const got = await detectCurrentBrowser({
    userAgent: UA.brave,
    brave: { isBrave: async () => true },
  });
  assert.equal(got, 'brave');
});

test('detectCurrentBrowser — Brave probe returns false → falls back to UA', async () => {
  const got = await detectCurrentBrowser({
    userAgent: UA.chrome,
    brave: { isBrave: async () => false },
  });
  assert.equal(got, 'google-chrome');
});

test('detectCurrentBrowser — Brave probe throws → falls back to UA', async () => {
  const got = await detectCurrentBrowser({
    userAgent: UA.firefox,
    brave: { isBrave: async () => { throw new Error('locked'); } },
  });
  assert.equal(got, 'firefox');
});

test('detectCurrentBrowser — no nav object at all → UA sniff only', async () => {
  const got = await detectCurrentBrowser({ userAgent: UA.chromium });
  assert.equal(got, 'chromium');
});

test('detectCurrentBrowser — no args → empty', async () => {
  assert.equal(await detectCurrentBrowser(), '');
  assert.equal(await detectCurrentBrowser({}), '');
});
