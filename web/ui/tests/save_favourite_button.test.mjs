// Tests for the Save-as-favourite button state mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSaveButton } from '../domains/favourites/lib/save_favourite_button.js';

const CID = 'a'.repeat(40);

test('nothing playing → hidden, empty fields', () => {
  const v = describeSaveButton(null, []);
  assert.equal(v.visible, false);
  assert.equal(v.text, '');
  assert.equal(v.disabled, false);
});

test('playing + not in favourites → "Save as favourite", enabled', () => {
  const v = describeSaveButton({ cid: CID, name: 'Channel' }, []);
  assert.equal(v.visible, true);
  assert.equal(v.text, 'Save as favourite');
  assert.equal(v.disabled, false);
  assert.equal(v.title, '');
});

test('playing + already in favourites → ★-prefixed label, disabled', () => {
  const favs = [{ name: 'Saved Channel', cid: CID }];
  const v = describeSaveButton({ cid: CID, name: 'Channel' }, favs);
  assert.equal(v.visible, true);
  assert.equal(v.text, '★ Saved as "Saved Channel"');
  assert.equal(v.disabled, true);
  assert.match(v.title, /Already in your favourites/);
});

test('lookup is case-insensitive on cid', () => {
  const favs = [{ name: 'X', cid: CID }];
  const v = describeSaveButton({ cid: CID.toUpperCase() }, favs);
  assert.equal(v.disabled, true);
  assert.equal(v.text, '★ Saved as "X"');
});

test('HIDDEN singleton is frozen — callers cannot mutate the shared default', () => {
  const v = describeSaveButton(null, []);
  assert.throws(() => { v.visible = true; });
});
