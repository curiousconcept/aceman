// Decision tree for how a Play click should be carried out.
//
// `play()` in app.js used to inline a nested if/else over the
// (playback_mode, default_browser, inBrowserSupported) tuple.
// Same four side-effecting paths every time, but each branch
// scattered DOM and network calls around a policy decision that
// is actually pure.
//
// decidePlaybackPath() pulls the policy out. It returns one of
// four shapes:
//
//   { kind: 'external-scheme', target }
//       Hand control to the host scheme handler — acestream://<cid>
//       opens VLC/mpv via xdg-open. `target` is the encoded
//       `external|name|source` string we want livePlaybackTarget
//       to remember.
//
//   { kind: 'open-in-other-browser', browserName, browserSource, label }
//       The user has chosen a specific browser to play in. We POST
//       to /api/open-in-browser and close this tab. `label` is the
//       display string used in the confirm() prompt.
//
//   { kind: 'in-tab-unsupported-fallback', warning, target }
//       Browser mode was chosen but mpegts.js / MSE isn't there.
//       Surface `warning` to the user and fall through to the
//       host scheme handler with `target` for bookkeeping.
//
//   { kind: 'in-tab' }
//       In-page mpegts.js playback. No extra parameters needed.
//
// Pure. No DOM, no globals.

import { browserLabel } from './browsers.js';
import { encodeTarget } from './playback_target.js';

const FALLBACK_WARNING =
  'In-browser playback unavailable (mpegts.js / MSE not supported). ' +
  'Falling back to external player.';

export function decidePlaybackPath(cfg, { inBrowserSupported } = {}) {
  cfg = cfg || {};

  if (cfg.playback_mode !== 'browser') {
    return {
      kind: 'external-scheme',
      target: encodeTarget('external',
                           cfg.default_player,
                           cfg.default_player_source),
    };
  }

  if (cfg.default_browser) {
    const source = cfg.default_browser_source || '';
    return {
      kind: 'open-in-other-browser',
      browserName: cfg.default_browser,
      browserSource: source,
      label: source
        ? `${browserLabel(cfg.default_browser)} (${source})`
        : browserLabel(cfg.default_browser),
    };
  }

  if (!inBrowserSupported) {
    return {
      kind: 'in-tab-unsupported-fallback',
      warning: FALLBACK_WARNING,
      target: encodeTarget('external',
                           cfg.default_player,
                           cfg.default_player_source),
    };
  }

  return { kind: 'in-tab' };
}
