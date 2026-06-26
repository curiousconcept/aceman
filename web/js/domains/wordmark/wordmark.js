// Wordmark domain: the ACEMAN title in the page header. Owns its glow
// toggle — default ON; click (or Space/Enter, role="button") flips .glow
// and persists the choice across sessions.
import { $ } from '../../shared/dom.js';
import { KEYS } from '../../lib/storage_keys.js';

export function initWordmark() {
  const title = $('aceman-title');
  if (!title) return;
  const stored = localStorage.getItem(KEYS.GLOW);
  title.classList.toggle('glow', stored === null ? true : stored === '1');
  const toggle = () => {
    const next = !title.classList.contains('glow');
    title.classList.toggle('glow', next);
    try { localStorage.setItem(KEYS.GLOW, next ? '1' : '0'); }
    catch (_) {}
  };
  title.onclick = toggle;
  title.onkeydown = e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  };
}
