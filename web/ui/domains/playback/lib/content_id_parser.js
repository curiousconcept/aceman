// Content-id parser. The engine identifies streams by a 40-hex token
// (a SHA-1 of the magnet metadata, roughly); the user can paste it
// bare or as an `acestream://` URL. We normalise to lowercase so the
// rest of the codebase can compare with ===.
//
// Pure, no DOM, no globals — safe to unit-test in Node.

export const HEX40 = /^[A-Fa-f0-9]{40}$/;

export function parseId(s) {
  const v = (s || '').trim().replace(/^acestream:\/\//i, '');
  return HEX40.test(v) ? v.toLowerCase() : null;
}
