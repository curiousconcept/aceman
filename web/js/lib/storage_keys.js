// Centralised localStorage / sessionStorage key names + the one-shot
// migration from the project's old `acewatch.*` namespace.
//
// Why this file exists: every key string lived in-line at its read
// site, so a rename required hunting through 2 k lines and praying
// every reference matched. With KEYS as the single source of truth a
// new key is named once and referenced symbolically everywhere.
//
// migrateLegacy(storage) is idempotent: it only copies keys that
// exist under the old name AND are unset under the new one, then
// removes the old key on a best-effort basis. Re-running is a no-op.

export const KEYS = Object.freeze({
  FAVORITES: 'aceman.favorites',
  LAST_PLAY: 'aceman.lastPlay',
  GLOW: 'aceman.acemanGlow',
  SHOW_ALL_BROWSERS: 'aceman.showAllBrowsers',
  RESTARTED_AT: 'aceman.restartedAt', // sessionStorage breadcrumb
});

const LEGACY_PREFIX = 'acewatch.';
const NEW_PREFIX = 'aceman.';

// Keys that existed under the old prefix and should be migrated to
// the new one. Anything not in this list is left alone.
const LEGACY_KEYS = [
  'acewatch.favorites',
  'acewatch.acemanGlow',
  'acewatch.lastPlay',
  'acewatch.showAllBrowsers',
];

export function migrateLegacy(storage) {
  if (!storage) return { migrated: [], skipped: [] };
  const migrated = [];
  const skipped = [];
  for (const oldK of LEGACY_KEYS) {
    const newK = oldK.replace(LEGACY_PREFIX, NEW_PREFIX);
    let oldV;
    try { oldV = storage.getItem(oldK); } catch (_) { oldV = null; }
    if (oldV === null) continue;
    let existingNew;
    try { existingNew = storage.getItem(newK); } catch (_) { existingNew = null; }
    if (existingNew === null) {
      try { storage.setItem(newK, oldV); migrated.push(newK); }
      catch (_) { skipped.push(newK); }
    } else {
      skipped.push(newK);
    }
    try { storage.removeItem(oldK); } catch (_) {}
  }
  return { migrated, skipped };
}
