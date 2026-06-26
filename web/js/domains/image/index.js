// Public interface for the image domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { installImage, refreshImageStatus, uninstallImage } from './image.js';
