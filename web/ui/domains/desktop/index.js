// Public interface for the desktop domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { refreshDesktopEntry, toggleDesktopEntry } from './desktop_entry.js';
