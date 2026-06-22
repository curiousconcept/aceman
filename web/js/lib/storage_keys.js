// Centralised localStorage / sessionStorage key names.
//
// Why this file exists: every key string used to live inline at its
// read site, so a rename required hunting through 2 k lines and
// praying every reference matched. With KEYS as the single source
// of truth a new key is named once and referenced symbolically
// everywhere.

export const KEYS = Object.freeze({
  FAVORITES: 'aceman.favorites',
  LAST_PLAY: 'aceman.lastPlay',
  GLOW: 'aceman.acemanGlow',
  SHOW_ALL_BROWSERS: 'aceman.showAllBrowsers',
  PLAYBACK_BUFFER: 'aceman.playbackBuffer',       // in-tab pre-roll seconds
  RESTARTED_AT: 'aceman.restartedAt',             // sessionStorage breadcrumb
  GPU_ACCEL: 'aceman.gpuAccel',                   // GPU acceleration settings JSON
});
