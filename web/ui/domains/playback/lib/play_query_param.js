// Page-query helpers.
//
// The desktop launcher / xdg-mime dispatch hands us a URL of the
// form `…/?play=<40-hex-cid>`. The cid here crosses a trust
// boundary — anyone who can make the user navigate to our origin
// can stuff arbitrary text into that param. We MUST parse it
// through the same 40-hex predicate as everything else, never lift
// the value straight into the cid input or play() call.
//
// Pure. Caller passes the search string (typically
// `window.location.search`), we return either a validated
// lowercased cid or null.

import { parseId } from './content_id_parser.js';

export function extractPlayCidFromUrl(searchString) {
  if (typeof searchString !== 'string') return null;
  let qs;
  try { qs = new URLSearchParams(searchString); }
  catch (_) { return null; }
  return parseId(qs.get('play'));
}
