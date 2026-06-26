// Public interface for the container-memory domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { initContainerMemory } from './container_memory.js';
