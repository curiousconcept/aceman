// Pure builder for the off-box ("open on another device") stream URL.
//
// Given the broker-reported LAN address plus a content id, return the
// engine getstream URL a player on another device (e.g. VLC on a phone
// or tablet) opens directly. Returns "" whenever a usable URL can't be
// formed — engine not LAN-exposed, no detected IP/port, or no valid cid
// — so callers treat "" as "nothing to show, hide the section".

const LAN_URL_CID_RE = /^[a-f0-9]{40}$/;

export function buildLanStreamUrl({ lanExposed, lanIp, lanPort, cid }) {
  if (!lanExposed || !lanIp || !lanPort) return '';
  if (!cid || !LAN_URL_CID_RE.test(cid)) return '';
  return `http://${lanIp}:${lanPort}/ace/getstream?id=${cid}`;
}
