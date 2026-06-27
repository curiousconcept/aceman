// Browser-side favourites store.
//
// In SQLite mode the server is authoritative. In browser mode we keep
// the list in localStorage so the user can still save channels when
// the server has no sqlite3 (older Pythons / stripped-down OS images).
//
// The factory takes an explicit `storage` so tests can pass an in-
// memory Map-backed stand-in instead of the real localStorage:
//
//   import { createBrowserFavouritesStore } from '../../../lib/favourites/browser_favs.js';
//   const favs = createBrowserFavouritesStore();        // production
//   const favs = createBrowserFavouritesStore(fakeLS);  // tests
//
// Duplicate-cid and duplicate-name handling mirror the SQLite backend
// so callers see the same Error semantics regardless of mode.

const STORAGE_KEY = 'aceman.favorites';

export function createBrowserFavouritesStore(storage) {
  const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) throw new Error('createBrowserFavouritesStore: no storage backend');

  const cmp = (a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  const list = () => {
    try { return JSON.parse(ls.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  };
  const save = arr => ls.setItem(STORAGE_KEY, JSON.stringify(arr));

  return {
    list,
    save,
    add(name, cid) {
      const arr = list();
      const dupe = arr.find(f => f.cid.toLowerCase() === cid.toLowerCase());
      if (dupe && dupe.name !== name) {
        const e = new Error(`already saved as '${dupe.name}'`);
        e.existingName = dupe.name;
        throw e;
      }
      const filtered = arr.filter(f => f.name !== name);
      filtered.push({ name, cid, last_played: null });
      filtered.sort(cmp);
      save(filtered);
    },
    delete(name) { save(list().filter(f => f.name !== name)); },
    rename(oldName, newName) {
      const arr = list();
      if (arr.some(f => f.name === newName && f.name !== oldName)) {
        throw new Error(`name '${newName}' is already in use`);
      }
      const f = arr.find(x => x.name === oldName);
      if (!f) throw new Error(`favourite '${oldName}' not found`);
      f.name = newName;
      arr.sort(cmp);
      save(arr);
    },
    touchCid(cid) {
      const arr = list();
      const now = new Date().toISOString();
      let touched = false;
      for (const f of arr) if (f.cid === cid) { f.last_played = now; touched = true; }
      if (touched) save(arr);
    },
  };
}
