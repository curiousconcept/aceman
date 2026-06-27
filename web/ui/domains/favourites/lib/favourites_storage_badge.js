// Pure mapping for the favourites-storage-mode badge.
//
// The favourites column header carries a tiny badge: 'sqlite' or
// 'browser'. The badge's tooltip surfaces the actual DB path when
// running SQLite-backed, or explains the localStorage fallback
// otherwise. Same "label + path on hover" pattern used for the
// Engine image and App launcher rows.
//
// Pure. No DOM, no globals.

const SQLITE_GENERIC_TOOLTIP = 'Favourites stored server-side in SQLite.';
const BROWSER_TOOLTIP =
  'Favourites stored in browser localStorage (server has no sqlite3).';

export function describeFavouritesStorageBadge(mode, favoritesPath) {
  if (mode === 'sqlite') {
    return {
      text: 'sqlite',
      title: favoritesPath
        ? `SQLite DB: ${favoritesPath}`
        : SQLITE_GENERIC_TOOLTIP,
    };
  }
  return { text: 'browser', title: BROWSER_TOOLTIP };
}
