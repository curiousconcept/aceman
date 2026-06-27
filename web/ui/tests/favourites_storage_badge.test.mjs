// Tests for the storage-mode badge mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFavouritesStorageBadge } from '../domains/favourites/lib/favourites_storage_badge.js';

test('sqlite mode with a path → DB-path tooltip', () => {
  const v = describeFavouritesStorageBadge('sqlite', '/home/user/.config/aceman/favorites.db');
  assert.equal(v.text, 'sqlite');
  assert.equal(v.title, 'SQLite DB: /home/user/.config/aceman/favorites.db');
});

test('sqlite mode with no path → generic SQLite tooltip', () => {
  const v = describeFavouritesStorageBadge('sqlite', '');
  assert.equal(v.text, 'sqlite');
  assert.match(v.title, /server-side in SQLite/);
});

test('sqlite mode with null path → generic SQLite tooltip', () => {
  const v = describeFavouritesStorageBadge('sqlite', null);
  assert.equal(v.text, 'sqlite');
  assert.match(v.title, /server-side in SQLite/);
});

test('browser mode → browser badge with localStorage explainer', () => {
  const v = describeFavouritesStorageBadge('browser');
  assert.equal(v.text, 'browser');
  assert.match(v.title, /browser localStorage/);
});

test('unknown mode defaults to browser', () => {
  // Defensive — a future mode that isn't in the switch shouldn't
  // accidentally promote to SQLite (which would imply
  // server-side persistence the page hasn't confirmed).
  const v = describeFavouritesStorageBadge('rogue');
  assert.equal(v.text, 'browser');
});

test('undefined mode is treated as browser too', () => {
  const v = describeFavouritesStorageBadge();
  assert.equal(v.text, 'browser');
});
