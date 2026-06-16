// Helpers around the /api/search endpoint.
//
// Both pieces are pure (no DOM, no fetch). The caller keeps
// ownership of the input element, the debounce timer (see
// ./debounce.js), and the actual fetch (see ./api.js); this module
// just provides the policy.

// Upstream's `/api/search` requires at least 2 useful characters,
// which matches what the search backend documents.
export const MIN_QUERY_LEN = 2;

export function shouldSearch(q) {
  return typeof q === 'string' && q.trim().length >= MIN_QUERY_LEN;
}

export function normaliseQuery(q) {
  return (typeof q === 'string' ? q : '').trim();
}

export function buildSearchUrl(q, base = '/api/search') {
  return `${base}?q=${encodeURIComponent(normaliseQuery(q))}`;
}
