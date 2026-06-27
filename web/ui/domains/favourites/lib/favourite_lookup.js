// Lookup helpers for the favourites list.
//
// `findFavouriteByCid(favs, cid)` does a case-insensitive cid match. The
// same three-line pattern was inlined in instaSave (saved-state
// pre-check), updateSaveButton (star indicator), and play() (name
// resolution). Centralising it ensures every caller observes the
// same normalisation (cid is always compared lowercase to lowercase)
// and any future change — say, the engine starting to emit cids in
// a different case — is a one-line fix.
//
// Pure. No DOM, no globals.

export function findFavouriteByCid(favs, cid) {
  if (!Array.isArray(favs) || typeof cid !== 'string' || !cid) return null;
  const needle = cid.toLowerCase();
  for (const f of favs) {
    if (f && typeof f.cid === 'string' && f.cid.toLowerCase() === needle) {
      return f;
    }
  }
  return null;
}
