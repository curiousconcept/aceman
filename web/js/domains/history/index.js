// Public interface for the history domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { closeHistoryDropdown, hideHistorySection, historyDropdownOpen, openHistoryDropdown } from './history.js';
