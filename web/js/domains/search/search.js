// Search domain. The unified Watch input doubles as a search box: when
// the value isn't a cid / acestream:// URL we treat it as a free-text
// query against /api/search (search-ace.stream), render paginated
// results, and let each result be played or saved as a favourite.
//
// The pure query logic (shouldSearch / normaliseQuery / buildSearchUrl)
// and pagination live in lib/ and are unit-tested; this module is the
// DOM wiring around them.
//
// All cross-module deps are forward imports from sibling domains:
// hideHistorySection (history), allFavs / instaSave / updateSaveButton
// (favourites), play + alignSearchToInput (playback).

import { $, showError, showBusy, hideBusy } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { parseId } from '../../lib/playback/content_id_parser.js';
import { debounce } from '../../lib/debounce.js';
import { paginate } from '../../lib/pagination.js';
import { shouldSearch, normaliseQuery, buildSearchUrl } from '../../lib/search_query.js';
import { findFavouriteByCid } from '../../lib/favourites/favourite_lookup.js';
import { hideHistorySection } from '../history/history.js';
import { allFavs, instaSave, updateSaveButton } from '../favourites/favourites.js';
import { play } from '../playback/playback.js';
import { alignSearchToInput } from '../playback/playback.js';

let lastSearchQuery = '';
// Pagination of search results. Mirrors the favourites pager — same
// 5-per-page convention applied to the upstream's MAX_RESULTS=50 cap.
let allSearchResults = [];
let searchPage = 0;
const SEARCH_PAGE_SIZE = 5;

// 600ms trailing-edge debounce — long enough that mid-word keystrokes don't
// fire a request, short enough to feel responsive after a pause.
export const onSearchInput = debounce(() => runSearch(), 600);

// Show/hide the search section based on what's in the unified input.
// We treat the input as a free-text search query iff it's NOT a 40-hex
// cid and NOT an acestream:// URL — parseId() returns non-null for
// both of those cases. Results stay visible during playback so the
// operator can hunt for a new channel while one is already on screen
// (the previous hide-while-playing behaviour was friction once the
// Watch input was the ONLY search affordance — there was no other
// way to look for something new without stopping first).
//
// When the section is hidden we also blank the "N results" status
// pill in the card title; otherwise the stale count lingers after
// the user stops playback of a search-clicked stream (cid in input,
// no results table on screen — confusing).
export function refreshSearchSection() {
  const sec = $('search-section');
  if (!sec) return;
  const v = $('cid-input').value || '';
  const isCid = parseId(v) !== null;
  const wantSearch = !isCid && shouldSearch(normaliseQuery(v));
  sec.style.display = wantSearch ? '' : 'none';
  if (wantSearch) hideHistorySection();
  if (!wantSearch) {
    const status = $('search-status');
    if (status) status.textContent = '';
  }
}

// Show/hide the explicit ✕ clear button next to the Watch input.
// Always visible (when there's a value) instead of relying on the
// native type=search × — Firefox hides that on blur, mobile
// browsers often skip it entirely, and a discoverable single click
// matters more than the native pixels.
export function refreshClearButton() {
  const btn = $('cid-clear');
  if (!btn) return;
  btn.style.display = $('cid-input').value ? '' : 'none';
}

export function clearCidInput() {
  const input = $('cid-input');
  if (!input) return;
  input.value = '';
  input.focus();
  updateSaveButton();
  refreshSearchSection();
  refreshClearButton();
  onSearchInput();
}

export async function runSearch() {
  // The unified Watch input doubles as the search input. parseId
  // catches cid / acestream:// values so we don't search those.
  const raw = $('cid-input').value || '';
  if (parseId(raw) !== null) {
    lastSearchQuery = '';
    $('search-results').innerHTML = '';
    $('search-status').textContent = '';
    refreshSearchSection();
    return;
  }
  const q = normaliseQuery(raw);
  lastSearchQuery = q;
  $('search-results').innerHTML = '';
  $('search-status').textContent = '';
  showError('');
  console.debug('[search] query', { len: q.length, query: q });
  if (!shouldSearch(q)) {
    console.debug('[search] skipped (too short)');
    refreshSearchSection();
    return;
  }
  refreshSearchSection();
  $('search-status').textContent = 'searching…';
  const t0 = performance.now();
  try {
    const data = await api(buildSearchUrl(q));
    if (q !== lastSearchQuery) {
      console.debug('[search] stale response, dropped', q);
      return;
    }
    const results = data.results || [];
    console.debug('[search] got', results.length, 'results in',
      Math.round(performance.now() - t0), 'ms');
    allSearchResults = results;
    searchPage = 0;
    renderSearchResults();
    $('search-status').textContent = results.length
      ? `${results.length} result${results.length === 1 ? '' : 's'}`
      : 'no matches';
  } catch (e) {
    if (q !== lastSearchQuery) return;
    console.warn('[search] failed:', e.message);
    $('search-status').textContent = '';
    showError('search failed: ' + e.message);
  }
}

// Re-render the visible results in place (e.g. after a favourites change
// flips a row's ★ saved-state). No-op when no search is active — keeps the
// allSearchResults buffer private to this module.
export function refreshSearchResultsIfAny() {
  if (allSearchResults.length) renderSearchResults();
}

// Init-facing pager handlers — keep searchPage private to this module.
export function searchPagePrev() { searchPage--; renderSearchResults(); }
export function searchPageNext() { searchPage++; renderSearchResults(); }

export function renderSearchResults() {
  const list = $('search-results');
  list.innerHTML = '';
  const p = paginate(allSearchResults.length, searchPage, SEARCH_PAGE_SIZE);
  searchPage = p.page;
  for (const r of p.slice(allSearchResults)) list.appendChild(renderSearchRow(r));
  const pager = $('search-pager');
  if (pager) {
    pager.style.display = allSearchResults.length > SEARCH_PAGE_SIZE ? '' : 'none';
    $('search-prev').disabled = !p.hasPrev;
    $('search-next').disabled = !p.hasNext;
    $('search-info').textContent = p.label();
  }
  requestAnimationFrame(alignSearchToInput);
}

export function renderSearchRow(r) {
  const row = document.createElement('div');
  row.className = 'fav';

  const wrap = document.createElement('div');
  wrap.className = 'fav-name-wrap';

  // Original-language name is primary white text; English translation is the
  // muted sub-label. If the names are identical (English-only channel) the
  // sub-label is omitted and the cid preview is shown instead.
  const primary = (r.name || r.translated_name || '').trim();
  const alt = (r.translated_name && r.translated_name !== r.name)
    ? r.translated_name.trim() : '';

  const name = document.createElement('span');
  name.className = 'fav-name';
  name.textContent = primary;
  name.title = r.cid;

  const sub = document.createElement('span');
  sub.className = 'fav-last';
  sub.textContent = alt || (r.cid.slice(0, 8) + '…');

  wrap.appendChild(name);
  wrap.appendChild(sub);

  wrap.onclick = async () => {
    $('cid-input').value = r.cid;
    showBusy('Starting…');
    try { await play({ name: primary, altName: alt }); } finally { hideBusy(); }
  };

  row.oncontextmenu = e => {
    e.preventDefault();
    navigator.clipboard.writeText(r.cid).then(() => {
      const prev = row.style.opacity;
      row.style.opacity = '0.5';
      setTimeout(() => { row.style.opacity = prev; }, 350);
    }).catch(() => {});
  };

  const saveBtn = document.createElement('button');
  // If this cid is already saved, render the button in its "saved" state
  // from the start — disabled, with the existing favourite name surfaced
  // if it doesn't match what we'd have called it. Saves a click + alert
  // round-trip and tells the user where to look in their favourites list.
  const existing = findFavouriteByCid(allFavs, r.cid);
  saveBtn.classList.add('icon-btn');
  if (existing) {
    markSearchRowSaved(saveBtn, existing.name, primary);
  } else {
    saveBtn.textContent = '★';
    saveBtn.title = 'Add to favourites (pick a name: English, Original, or custom)';
    saveBtn.setAttribute('aria-label', 'Add to favourites');
    saveBtn.onclick = () => instaSave(r, saveBtn, primary);
  }

  row.appendChild(wrap);
  row.appendChild(saveBtn);
  return row;
}

// Flip a search-row's save button into the "already in favourites" state.
// Keeps the same single-glyph footprint as the Save state (avoids
// shifting siblings) and surfaces the favourite name only as a tooltip.
export function markSearchRowSaved(btn, favName, rowPrimary) {
  btn.disabled = true;
  btn.classList.add('icon-btn', 'has-tooltip');
  btn.textContent = '★';
  btn.title = favName;
  btn.setAttribute('aria-label', btn.title);
  btn.onclick = null;
}
