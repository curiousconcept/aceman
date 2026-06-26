// Public interface for the favourites domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { allFavs, browserFavs, favPageNext, favPagePrev, instaSave, loadFavs, saveFav, setFavSearch, updateSaveButton } from './favourites.js';
export { findFavouriteByCid } from './lib/favourite_lookup.js';
export { describeFavouritesStorageBadge } from './lib/favourites_storage_badge.js';
