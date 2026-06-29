// Display labels for the playback-target dropdown's external players and
// their install source. Mirrors browsers.js/browserLabel.
//
// Detected player names are binary names (e.g. "vlc", "mpv"); we show a
// brand-correct label for the ones we know and fall back to the detected
// name as-is for anything else. Pure. No DOM, no globals.

const PLAYER_LABELS = { vlc: 'VLC', mpv: 'MPV' };

export function playerLabel(name) {
  return PLAYER_LABELS[name] || name || '';
}

// Install source tag ("system" / "flatpak") → capitalised for the dropdown
// so it reads consistently next to the (capitalised) player/browser name.
export function sourceLabel(source) {
  const s = source || '';
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
