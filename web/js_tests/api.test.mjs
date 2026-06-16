// Tests for the JSON fetch wrapper.
//
// We inject a fake `fetch` that returns whatever Response shape the
// test needs. No network, no globals.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../js/lib/api.js';

function fakeRes({ status = 200, body = '', headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers,
    text: async () => body,
  };
}

// Builds a fetch stub that records every call and returns a queue
// of canned responses (or a single response if not an array).
function fakeFetch(canned) {
  const calls = [];
  const queue = Array.isArray(canned) ? [...canned] : [canned];
  const fn = async (path, opts) => {
    calls.push({ path, opts });
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  fn.calls = calls;
  return fn;
}

test('GET 200 → parsed JSON body', async () => {
  const f = fakeFetch(fakeRes({ status: 200, body: '{"a":1}' }));
  const api = createApi(f);
  const data = await api('/api/x');
  assert.deepEqual(data, { a: 1 });
});

test('GET 200 empty body → null', async () => {
  const f = fakeFetch(fakeRes({ status: 200, body: '' }));
  const api = createApi(f);
  assert.equal(await api('/api/x'), null);
});

test('GET 200 malformed JSON → null (best-effort, no throw)', async () => {
  const f = fakeFetch(fakeRes({ status: 200, body: '{ not valid' }));
  const api = createApi(f);
  assert.equal(await api('/api/x'), null);
});

test('default Content-Type is application/json', async () => {
  const f = fakeFetch(fakeRes());
  const api = createApi(f);
  await api('/api/x', { method: 'POST', body: '{}' });
  assert.equal(f.calls[0].opts.headers['content-type'], 'application/json');
});

test('caller can override Content-Type', async () => {
  const f = fakeFetch(fakeRes());
  const api = createApi(f);
  await api('/api/x', { method: 'POST', body: '{}',
                        headers: { 'content-type': 'text/plain' } });
  assert.equal(f.calls[0].opts.headers['content-type'], 'text/plain');
});

test('non-2xx → throws Error with .status and .data populated', async () => {
  const f = fakeFetch(fakeRes({
    status: 409,
    body: JSON.stringify({ error: 'duplicate', existing_name: 'foo' }),
  }));
  const api = createApi(f);
  let err;
  try { await api('/api/x'); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.status, 409);
  assert.equal(err.message, 'duplicate');
  assert.equal(err.data.existing_name, 'foo');
});

test('non-2xx with non-JSON body → message falls back to body text', async () => {
  const f = fakeFetch(fakeRes({ status: 500, body: 'kaboom' }));
  const api = createApi(f);
  let err;
  try { await api('/api/x'); } catch (e) { err = e; }
  assert.equal(err.status, 500);
  assert.equal(err.message, 'kaboom');
});

test('non-2xx with empty body → message uses statusText', async () => {
  const f = fakeFetch(fakeRes({ status: 500, body: '' }));
  const api = createApi(f);
  let err;
  try { await api('/api/x'); } catch (e) { err = e; }
  assert.equal(err.status, 500);
  assert.equal(err.message, 'ERR');
});

test('createApi throws when no fetch is available', () => {
  // We have to NOT pass fetchImpl AND make sure globalThis.fetch is
  // unreachable. Saving / restoring is enough.
  const saved = globalThis.fetch;
  try {
    delete globalThis.fetch;
    assert.throws(() => createApi(), /no fetch/);
  } finally {
    globalThis.fetch = saved;
  }
});
