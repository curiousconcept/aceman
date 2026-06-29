// Pure builder for the Player dropdown's option tree.
//
// `renderPlaybackTargets()` in app.js used to mix three concerns:
//   1. POLICY — which targets to surface (filter the user's own
//      browser when not "show all", suppress the in-tab option if
//      mpegts.js / MSE isn't there, build the optgroups, decide
//      what to do when nothing is available).
//   2. SHAPE — how each option's `value` / `text` strings are
//      assembled.
//   3. DOM — innerHTML, document.createElement, appendChild.
//
// (3) keeps living in app.js; (1) and (2) are pulled in here so the
// hard logic gets exercised by deterministic unit tests instead of
// only being checked by manually clicking through the UI.
//
// Returns the same shape regardless of whether anything is
// available — caller drives the DOM off `groups` and reads
// `hasAnyTarget` / `hintMessage` for the "no targets" gate.

import { browserLabel } from './browsers.js';
import { playerLabel, sourceLabel } from './players.js';
import { encodeTarget } from './playback_target.js';

const NO_TARGETS_HINT =
  'No playback target available. Install a browser, vlc, or mpv ' +
  '(system package or Flatpak), then reload.';

export function buildPlaybackOptions({
  detectedPlayers = [],
  detectedBrowsers = [],
  currentBrowser = '',
  showAll = false,
  inBrowserSupported = false,
} = {}) {
  // --- "This tab" (in-page mpegts.js) ----------------------------
  // With filtering on (the default) we know the user's current
  // browser is the one playing here, so we name it explicitly:
  // "This Firefox tab" reads clearer than the generic. With "show
  // all" on, the bare option could correspond to any of several
  // installs of the same browser, so the generic is honest.
  const thisLabel = 'This Tab';
  const thisTabOption = {
    value: 'browser',
    text: inBrowserSupported
      ? thisLabel
      : `${thisLabel} — unsupported (mpegts.js / MSE unavailable)`,
    disabled: !inBrowserSupported,
  };

  // --- Other browsers --------------------------------------------
  // Skip any entry matching the current browser by name unless
  // "show all" is on. UA can't distinguish system vs flatpak
  // Firefox, so we hide both installs — the user opts into the
  // noise explicitly via the checkbox.
  const otherBrowsers = showAll
      ? detectedBrowsers
      : detectedBrowsers.filter(b => b.name !== currentBrowser);
  const otherBrowserOptions = otherBrowsers.map(b => ({
    value: encodeTarget('browser', b.name, b.source),
    text: `${browserLabel(b.name)} (${sourceLabel(b.source)})`,
    disabled: false,
  }));

  // --- External players (VLC, mpv, ...) --------------------------
  // Same dedup logic as browsers: when showAll is off, keep only the
  // first detected install per player name so system + flatpak copies
  // of the same app don't both appear.
  const visiblePlayers = showAll
    ? detectedPlayers
    : detectedPlayers.filter((p, i, arr) => arr.findIndex(q => q.name === p.name) === i);
  const playerOptions = visiblePlayers.map(p => ({
    value: encodeTarget('external', p.name, p.source),
    text: `${playerLabel(p.name)} (${sourceLabel(p.source)})`,
    disabled: false,
  }));

  const groups = [{ label: null, options: [thisTabOption] }];
  if (otherBrowserOptions.length) {
    groups.push({ label: 'Other Browsers', options: otherBrowserOptions });
  }
  if (playerOptions.length) {
    groups.push({ label: 'External Players', options: playerOptions });
  }

  // "No usable target" means we have nothing the user can actually
  // click: no detected browsers, no detected external players, and
  // in-tab playback is unsupported. The "This tab" option is still
  // *shown* (so the user knows what's missing), just disabled.
  const hasAnyTarget = inBrowserSupported
      || detectedBrowsers.length > 0
      || detectedPlayers.length > 0;
  return {
    groups,
    hasAnyTarget,
    hintMessage: hasAnyTarget ? '' : NO_TARGETS_HINT,
  };
}
