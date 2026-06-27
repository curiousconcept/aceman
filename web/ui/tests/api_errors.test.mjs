// Tests for the structured-error helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExistingName } from '../domains/favourites/lib/api_errors.js';

test('extracts from a 409 api.js Error (server collision shape)', () => {
  const err = Object.assign(new Error('duplicate'), {
    status: 409,
    data: { error: 'duplicate', existing_name: 'My Channel' },
  });
  assert.equal(extractExistingName(err), 'My Channel');
});

test('extracts from a browser-store Error (in-memory collision shape)', () => {
  const err = Object.assign(new Error('already saved'), {
    existingName: 'Local Fav',
  });
  assert.equal(extractExistingName(err), 'Local Fav');
});

test('409 without existing_name field → null', () => {
  const err = Object.assign(new Error('duplicate'), {
    status: 409, data: { error: 'duplicate' },
  });
  assert.equal(extractExistingName(err), null);
});

test('non-409 status → null even with the field present', () => {
  // Defensive: existing_name is meaningful only as a 409 marker.
  const err = Object.assign(new Error('uh oh'), {
    status: 500, data: { existing_name: 'X' },
  });
  assert.equal(extractExistingName(err), null);
});

test('existing_name field of wrong type → null (no crash)', () => {
  const err = Object.assign(new Error('x'), {
    status: 409, data: { existing_name: 42 },
  });
  assert.equal(extractExistingName(err), null);
});

test('empty string existingName → null (treated as missing)', () => {
  const err = Object.assign(new Error('x'), { existingName: '' });
  assert.equal(extractExistingName(err), null);
});

test('null / undefined input → null', () => {
  assert.equal(extractExistingName(null), null);
  assert.equal(extractExistingName(undefined), null);
});

test('plain Error with neither marker → null', () => {
  assert.equal(extractExistingName(new Error('whatever')), null);
});

test('prefers server shape when both markers are present', () => {
  // Vanishingly rare but well-defined: server speaks first.
  const err = Object.assign(new Error('x'), {
    status: 409,
    data: { existing_name: 'from-server' },
    existingName: 'from-store',
  });
  assert.equal(extractExistingName(err), 'from-server');
});
