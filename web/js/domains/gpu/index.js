// Public interface for the gpu domain. Other slices (and the
// bootstrap) import from here, never from the files behind it —
// this is the boundary. Internals stay private to the folder.

export { buildGpuParams, gpuEncodeLabel, initGpuCard } from './gpu.js';
