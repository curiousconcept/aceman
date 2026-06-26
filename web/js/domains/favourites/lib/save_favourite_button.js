// Pure mapping for the "Save as favourite" / star indicator button
// next to the cid input.
//
// Three states:
//   1) no stream playing            → hidden
//   2) playing, NOT yet in favourites → "Save as favourite", enabled
//   3) playing, ALREADY in favourites → "★ Saved as <name>", disabled
//
// The lookup is delegated to ./fav_lookup.js so the same
// case-insensitive cid-match policy is shared with every other
// favourites query in the app.
//
// Pure. No DOM, no globals.

import { findFavouriteByCid } from '../../../lib/favourites/favourite_lookup.js';

export function describeSaveButton(current, favs) {
  if (!current) return HIDDEN;
  const fav = findFavouriteByCid(favs, current.cid);
  if (fav) {
    return {
      visible: true,
      text: `★ Saved as "${fav.name}"`,
      disabled: true,
      title: 'Already in your favourites — open the Favourites column to manage.',
    };
  }
  return {
    visible: true,
    text: 'Save as favourite',
    disabled: false,
    title: '',
  };
}

const HIDDEN = Object.freeze({
  visible: false,
  text: '',
  disabled: false,
  title: '',
});
