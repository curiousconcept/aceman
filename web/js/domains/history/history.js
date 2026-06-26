// Watch-history domain (sqlite storage mode only). Two surfaces over the
// same /api/history data:
//   * a compact dropdown under the Watch input (double-click to open),
//     showing the 5 most-recent plays + a "Show all" expander;
//   * an inline section listing every entry, each playable, favouritable
//     (★), or deletable (🗑), that auto-hides after 30s of no pointer move.
//
// The UTC→local timestamp formatting is pure and unit-tested in
// lib/sqlite_time.js; this module is the DOM wiring.
//
// All cross-module deps are forward imports: allFavs + instaSave
// (favourites), play + alignSearchToInput (playback), mode (shared
// runtime flags).

import { $, showBusy, hideBusy } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { formatSqliteUtcToLocal } from './lib/sqlite_time.js';
import { findFavouriteByCid } from '../../lib/favourites/favourite_lookup.js';
import { allFavs, instaSave } from '../favourites/favourites.js';
import { play, alignSearchToInput } from '../playback/playback.js';
import { mode } from '../../shared/runtime.js';

let _historyDropdown = null;
let _historyTimer = null;
let _historyMoveListener = null;

export function closeHistoryDropdown() {
  if (_historyDropdown) { _historyDropdown.remove(); _historyDropdown = null; }
}

// Lets app.js's input handler check open-state without reaching into the
// module-private dropdown ref.
export function historyDropdownOpen() {
  return _historyDropdown !== null;
}

function _startHistoryTimer() {
  clearTimeout(_historyTimer);
  _historyTimer = setTimeout(() => hideHistorySection(), 30_000);
}

export function hideHistorySection() {
  clearTimeout(_historyTimer);
  _historyTimer = null;
  const s = $('history-section');
  if (s && _historyMoveListener) {
    s.removeEventListener('pointermove', _historyMoveListener);
    _historyMoveListener = null;
  }
  if (s) s.style.display = 'none';
}

// Convert a SQLite 'YYYY-MM-DD HH:MM:SS' UTC stamp to a local
// 'YYYY-MM-DD HH:MM' string using the browser's OS timezone.
// Thin wrapper over the pure formatter in lib/sqlite_time.js (tested there).
const sqliteUtcToLocal = formatSqliteUtcToLocal;

export function showHistorySection(entries) {
  const sec = $('history-section');
  const list = $('history-list');
  if (!sec || !list) return;
  list.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'status';
    empty.style.cssText = 'text-align:center;padding:.5rem 0';
    empty.textContent = 'No watch history yet.';
    list.appendChild(empty);
  } else {
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:.25rem';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear all';
    clearBtn.className = 'danger-outline';
    clearBtn.style.cssText = 'font-size:.75rem;padding:.15rem .5rem';
    clearBtn.onclick = async () => {
      await api('/api/history', { method: 'DELETE' }).catch(() => {});
      showHistorySection([]);
    };
    header.appendChild(clearBtn);
    list.appendChild(header);
    for (const h of entries) list.appendChild(renderHistoryRow(h));
  }
  sec.style.display = '';
  requestAnimationFrame(alignSearchToInput);
  if (!_historyMoveListener) {
    _historyMoveListener = () => _startHistoryTimer();
    sec.addEventListener('pointermove', _historyMoveListener);
  }
  _startHistoryTimer();
}

function renderHistoryRow(h) {
  const row = document.createElement('div');
  row.className = 'fav';

  const wrap = document.createElement('div');
  wrap.className = 'fav-name-wrap';

  const name = document.createElement('span');
  name.className = 'fav-name';
  name.textContent = h.name;
  name.title = h.cid;

  const sub = document.createElement('span');
  sub.className = 'fav-last';
  sub.textContent = sqliteUtcToLocal(h.played_at);

  wrap.appendChild(name);
  wrap.appendChild(sub);
  wrap.onclick = async () => {
    hideHistorySection();
    $('cid-input').value = h.cid;
    showBusy('Starting…');
    try { await play({ name: h.name }); } finally { hideBusy(); }
  };

  row.oncontextmenu = e => {
    e.preventDefault();
    navigator.clipboard.writeText(h.cid).then(() => {
      const prev = row.style.opacity;
      row.style.opacity = '0.5';
      setTimeout(() => { row.style.opacity = prev; }, 350);
    }).catch(() => {});
  };

  const existing = findFavouriteByCid(allFavs, h.cid);
  if (!existing) {
    const starBtn = document.createElement('button');
    starBtn.className = 'icon-btn';
    starBtn.textContent = '★';
    starBtn.title = 'Add to favourites';
    starBtn.setAttribute('aria-label', 'Add to favourites');
    starBtn.onclick = () => instaSave(
      { cid: h.cid, name: h.name, translated_name: h.name }, starBtn, h.name);
    row.appendChild(wrap);
    row.appendChild(starBtn);
  } else {
    row.appendChild(wrap);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.textContent = '🗑';
  delBtn.title = 'Remove from history';
  delBtn.setAttribute('aria-label', 'Remove from history');
  delBtn.onclick = async () => {
    await api('/api/history/' + encodeURIComponent(h.cid), { method: 'DELETE' })
      .catch(() => {});
    row.remove();
  };
  row.appendChild(delBtn);

  return row;
}

export async function openHistoryDropdown() {
  closeHistoryDropdown();
  if (mode !== 'sqlite') return;
  let all;
  try { all = await api('/api/history'); } catch { return; }
  if (!all || !all.length) return;

  const input = $('cid-input');
  const inputRect = input.getBoundingClientRect();

  const dd = document.createElement('div');
  dd.id = 'history-dropdown';
  dd.style.left = inputRect.left + 'px';
  dd.style.top = (inputRect.bottom + 2) + 'px';
  dd.style.width = inputRect.width + 'px';

  const top5 = all.slice(0, 5);
  for (const h of top5) {
    const opt = document.createElement('div');
    opt.className = 'aceman-select-option';
    const nameSpan = document.createElement('strong');
    nameSpan.textContent = h.name;
    const cidSpan = document.createElement('span');
    cidSpan.style.cssText = 'color:var(--mut);font-size:.78rem;margin-left:.5rem';
    cidSpan.textContent = h.cid.slice(0, 8) + '…';
    opt.appendChild(nameSpan);
    opt.appendChild(cidSpan);
    opt.onclick = () => {
      closeHistoryDropdown();
      $('cid-input').value = h.cid;
      showBusy('Starting…');
      play({ name: h.name }).finally(hideBusy);
    };
    dd.appendChild(opt);
  }

  if (all.length > 5) {
    const showAll = document.createElement('div');
    showAll.className = 'aceman-select-option';
    showAll.style.cssText = 'border-top:1px solid #333;color:var(--mut);font-size:.82rem';
    showAll.textContent = `Show all (${all.length})`;
    showAll.onclick = () => {
      closeHistoryDropdown();
      showHistorySection(all);
    };
    dd.appendChild(showAll);
  }

  document.body.appendChild(dd);
  _historyDropdown = dd;
}

// Click outside the dropdown (and not on the input) closes it.
document.addEventListener('click', e => {
  if (_historyDropdown && !_historyDropdown.contains(e.target) &&
      e.target !== $('cid-input')) {
    closeHistoryDropdown();
  }
});
