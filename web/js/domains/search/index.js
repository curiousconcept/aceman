// Public interface for the search domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { clearCidInput, markSearchRowSaved, onSearchInput, refreshClearButton, refreshSearchResultsIfAny, refreshSearchSection, runSearch, searchPageNext, searchPagePrev } from './search.js';
