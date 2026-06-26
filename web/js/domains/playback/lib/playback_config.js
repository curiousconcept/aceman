// Convert a Player-dropdown selection value into the JSON payload
// the /api/config endpoint expects.
//
// The dropdown packs three target classes into one string (see
// ./playback_target.js):
//
//   "browser"               → in-tab mpegts.js
//   "browser|name|source"   → open a new window in browser X
//   "external|name|source"  → VLC/mpv via the acestream:// scheme
//
// /api/config sets either (playback_mode='browser', default_browser*)
// or (playback_mode='external', default_player*). This module
// translates between the two without going near the network or DOM.
//
// Pure.

import { parseTarget } from './playback_target.js';

export function targetValueToConfig(value) {
  // Bare 'browser' — the in-tab player, no specific browser pinned.
  if (value === 'browser') {
    return {
      playback_mode: 'browser',
      default_browser: '',
      default_browser_source: '',
    };
  }
  const parsed = parseTarget(value);
  if (parsed.kind === 'browser') {
    return {
      playback_mode: 'browser',
      default_browser: parsed.name,
      default_browser_source: parsed.source,
    };
  }
  // Anything else collapses to external — including the empty/
  // unknown case. Defaults are blanks; the launcher refuses to
  // fire without a chosen player, which is the correct behaviour.
  return {
    playback_mode: 'external',
    default_player: parsed.name,
    default_player_source: parsed.source,
  };
}
