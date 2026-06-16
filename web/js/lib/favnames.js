// Favourite-name helpers.
//
// `uniqueFavName(label, takenNames)` normalises a candidate label
// (whitespace + length cap) and appends "(2)", "(3)" … until it
// doesn't collide with any name in `takenNames`. Returns null for
// empty/whitespace-only labels so callers can hide a UI option.
//
// `pickFavName(result, takenNames)` picks the default name for a
// search result: translated_name → name → "ace <cid8>" fallback.
//
// Pure. `takenNames` is passed explicitly so the same function is
// testable without faking a module-level list.

const MAX_LEN = 124; // leaves room for a " (NN)" suffix within a 128-cap

export function uniqueFavName(label, takenNames) {
  let base = (label || '').replace(/\s+/g, ' ').trim();
  if (!base) return null;
  base = base.slice(0, MAX_LEN);
  const taken = new Set(takenNames || []);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 999; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export function pickFavName(r, takenNames) {
  return uniqueFavName(r.translated_name || r.name, takenNames) ||
         uniqueFavName('ace ' + (r.cid || '').slice(0, 8), takenNames);
}
