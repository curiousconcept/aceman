import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLanStreamUrl } from '../domains/playback/lib/lan_url.js';

const CID = 'a'.repeat(40);
const base = { lanExposed: true, lanIp: '192.168.1.5', lanPort: 6878, cid: CID };

test('builds the engine getstream URL when exposed with a valid cid', () => {
  assert.equal(
    buildLanStreamUrl(base),
    `http://192.168.1.5:6878/ace/getstream?id=${CID}`);
});

test('empty when not exposed', () => {
  assert.equal(buildLanStreamUrl({ ...base, lanExposed: false }), '');
});

test('empty when IP or port missing', () => {
  assert.equal(buildLanStreamUrl({ ...base, lanIp: '' }), '');
  assert.equal(buildLanStreamUrl({ ...base, lanPort: 0 }), '');
});

test('empty on a missing or malformed cid', () => {
  for (const cid of ['', undefined, 'xyz', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41)]) {
    assert.equal(buildLanStreamUrl({ ...base, cid }), '', `cid=${cid}`);
  }
});
