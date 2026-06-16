// Pagination math, shared between the favourites pager and the
// search results pager. Two callers used to compute identical
// arithmetic in-line (pageCount, clamped page, slice indices,
// prev/next disabled, "N–M of T" label) which drifted over time.
//
// Pure. No DOM. Pass in the totals you have, get back the numbers
// + a helper to slice your array.

export function paginate(total, page, size) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('paginate: page size must be a positive number');
  }
  const safeTotal = Math.max(0, Math.floor(total));
  const pageCount = Math.max(1, Math.ceil(safeTotal / size));
  // Clamp page to a valid index even if the caller stored a stale one
  // (e.g. items shrank between renders).
  let p = Math.floor(page);
  if (!Number.isFinite(p) || p < 0) p = 0;
  if (p >= pageCount) p = pageCount - 1;
  const first = p * size;
  const last = Math.min(safeTotal, first + size);
  return {
    page: p,
    pageCount,
    first,
    last,
    isEmpty: safeTotal === 0,
    hasPrev: p > 0,
    hasNext: p < pageCount - 1,
    slice(arr) { return arr.slice(first, last); },
    // Conventional "first–last of total" label. Empty when no items.
    label() {
      if (safeTotal === 0) return '';
      return `${first + 1}–${last} of ${safeTotal}`;
    },
  };
}
