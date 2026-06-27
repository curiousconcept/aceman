// The app-wide JSON fetch singleton.
//
// Wraps ./lib/api.js (unit-tested via createApi(fakeFetch)); the
// production instance binds globalThis.fetch. Every feature module
// imports this same `api` so there's one place that owns request
// defaults / error shaping.

import { createApi } from '../lib/api.js';

export const api = createApi();
