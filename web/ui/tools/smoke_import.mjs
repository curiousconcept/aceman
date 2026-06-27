// Module-graph smoke check for the browser bundle (refactor aid).
//
// NOT a unit test — a link checker. It stubs a forgiving universal DOM
// and imports the entry module(s). If the ES module graph has a broken
// import (missing export), an assignment to an imported binding, or a
// circular-import TDZ access, the import() rejects and this exits non-zero.
// Behaviour is NOT exercised — only that the graph loads and the init
// IIFE survives its synchronous prefix. Run in the npm-sandbox:
//   node ui/tools/smoke_import.mjs ui/main.js [ui/domains/foo/foo.js ...]

// A callable, infinitely-chainable fake DOM node: any property read or
// method call returns the node itself, so arbitrary DOM glue runs
// without throwing.
const node = new Proxy(function () {}, {
  get(_t, p) {
    if (p === Symbol.toPrimitive) return () => '';
    if (p === 'textContent' || p === 'value' || p === 'innerHTML' || p === 'className') return '';
    if (p === 'dataset') return {};
    if (p === 'length') return 0;
    if (p === 'classList' || p === 'style') return node;
    return node;
  },
  set() { return true; },
  apply() { return node; },
  has() { return true; },
});

// Some of these (navigator, fetch) are read-only getters on globalThis in
// Node 24, so defineProperty rather than plain assignment.
const def = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

def('document', {
  getElementById: () => node,
  querySelector: () => node,
  querySelectorAll: () => [],
  createElement: () => node,
  createDocumentFragment: () => node,
  addEventListener() {}, removeEventListener() {},
  body: node, documentElement: node, head: node,
});
def('window', {
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { search: '', href: '', origin: 'http://localhost' },
  innerWidth: 0, innerHeight: 0, devicePixelRatio: 1,
  CSS: { escape: s => s },
  requestAnimationFrame() { return 0; },
});
def('CSS', { escape: s => s });
def('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
def('navigator', { clipboard: { writeText: () => Promise.resolve() }, userAgent: '' });
def('fetch', () => new Promise(() => {}));      // never resolves; IIFE suspends harmlessly
def('requestAnimationFrame', () => 0);

// The init IIFE fires async work against the stubs; swallow the noise —
// we only care that the synchronous module evaluation linked.
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

const targets = process.argv.slice(2);
if (!targets.length) { console.error('usage: smoke_import.mjs <module> ...'); process.exit(2); }

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

let failed = 0;
for (const t of targets) {
  try {
    await import(pathToFileURL(resolve(process.cwd(), t)).href);
    console.log('  LINK OK   ' + t);
  } catch (e) {
    failed++;
    console.log('  LINK FAIL ' + t + '  →  ' + (e && e.message));
  }
}
process.exit(failed ? 1 : 0);
