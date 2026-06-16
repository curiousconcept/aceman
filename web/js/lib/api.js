// Tiny JSON fetch wrapper used by every backend call in the app.
//
// Responsibilities:
//   * default the Content-Type to application/json
//   * parse JSON best-effort (empty body → null, malformed → null)
//   * convert non-2xx responses into Errors with .status and .data
//     so callers can branch on 409 / look at .data.existing_name etc.
//
// `createApi(fetchImpl)` lets tests inject a fake fetch. Production
// passes nothing → it picks up `globalThis.fetch`.

export function createApi(fetchImpl) {
  const fetcher = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetcher) throw new Error('createApi: no fetch implementation');

  return async function api(path, opts = {}) {
    const res = await fetcher(path, {
      headers: {
        'content-type': 'application/json',
        ...(opts.headers || {}),
      },
      ...opts,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { /* leave null */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || text || res.statusText);
      err.status = res.status;
      err.data = data; // preserve fields like existing_name on 409
      throw err;
    }
    return data;
  };
}
