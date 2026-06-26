// Pure mapping from "where the Play came from" to the display
// name pair we render in the now-playing card / tab title.
//
// Priority order:
//   1. Caller-provided opts.name / opts.altName — this wins
//      because it carries the most context (the actual row the
//      user clicked).
//   2. If only the primary name is missing, look it up in the
//      favourites list by cid — so a raw cid typed into the input
//      still gets its proper saved label.
//   3. Otherwise empty strings.
//
// Pure. No DOM, no globals.

import { findFavouriteByCid } from '../../../lib/favourites/favourite_lookup.js';

export function resolveDisplayName(opts, favs, cid) {
  const o = opts || {};
  let name = typeof o.name === 'string' ? o.name.trim() : '';
  const sub  = typeof o.altName === 'string' ? o.altName.trim() : '';
  if (!name) {
    const fav = findFavouriteByCid(favs, cid);
    if (fav) name = fav.name;
  }
  return { name, sub };
}
