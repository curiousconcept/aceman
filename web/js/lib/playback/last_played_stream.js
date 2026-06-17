// Persistence layer for the "last played stream" hint.
//
// We stash a tiny snapshot in localStorage each time play() fires so
// a reload can rehydrate the now-playing card + cid input without
// hitting the broker. Read paths refuse to use a stashed cid that
// isn't 40 hex characters — the value crosses a trust boundary
// (localStorage is writable by any script in this origin) and we
// don't want a malformed value to slip into the play URL.
//
// All functions take the storage backend explicitly so tests can
// pass a Map-backed fake and pin behaviour without touching the
// real localStorage.
//
// `cid` is required; `name` and `sub` are optional display strings.

import { KEYS } from '../storage_keys.js';
import { HEX40 } from './content_id_parser.js';

export function saveLastPlay(storage, { cid, name, sub } = {}) {
  if (!storage || typeof cid !== 'string' || !HEX40.test(cid)) return false;
  try {
    storage.setItem(KEYS.LAST_PLAY, JSON.stringify({
      cid: cid.toLowerCase(),
      name: typeof name === 'string' ? name : '',
      sub: typeof sub === 'string' ? sub : '',
    }));
    return true;
  } catch (_) { return false; }
}

export function loadLastPlay(storage) {
  if (!storage) return null;
  let raw;
  try { raw = storage.getItem(KEYS.LAST_PLAY); }
  catch (_) { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.cid !== 'string' || !HEX40.test(parsed.cid)) return null;
  return {
    cid: parsed.cid.toLowerCase(),
    name: typeof parsed.name === 'string' ? parsed.name : '',
    sub: typeof parsed.sub === 'string' ? parsed.sub : '',
  };
}

export function clearLastPlay(storage) {
  if (!storage) return;
  try { storage.removeItem(KEYS.LAST_PLAY); } catch (_) {}
}
