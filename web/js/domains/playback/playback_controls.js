// Playback card controls: the in-tab stats line and the pre-roll buffer
// slider. Both are card UI backed by localStorage (+ the server config
// for the buffer, so the aceman CLI's external player matches the tab).
import { $ } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { KEYS } from '../../lib/storage_keys.js';
import { bufferLabel } from './lib/playback_buffer.js';
import { notifyRestartNeeded } from './playback.js';

export function initPlaybackControls() {
  initStatsToggle();
  initBufferSlider();
}

// Stats line toggle — click to hide, "Display Stats" button to restore.
function initStatsToggle() {
  let statsHidden = localStorage.getItem(KEYS.STATS_HIDDEN) === '1';
  const applyStatsVis = () => {
    const s = $('pb-video-status');
    const b = $('show-stats-btn');
    if (!s || !b) return;
    s.style.display = statsHidden ? 'none' : '';
    b.style.display = statsHidden ? '' : 'none';
  };
  applyStatsVis();
  const pbStatus = $('pb-video-status');
  if (pbStatus) {
    pbStatus.onclick = () => {
      statsHidden = true;
      localStorage.setItem(KEYS.STATS_HIDDEN, '1');
      applyStatsVis();
    };
    pbStatus.oncontextmenu = e => {
      e.preventDefault();
      const text = pbStatus.textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const prev = pbStatus.style.opacity;
        pbStatus.style.opacity = '1';
        pbStatus.style.color = 'var(--acc)';
        setTimeout(() => {
          pbStatus.style.opacity = prev;
          pbStatus.style.color = '';
        }, 600);
      }).catch(() => {});
    };
  }
  const showStatsBtn = $('show-stats-btn');
  if (showStatsBtn) showStatsBtn.onclick = () => {
    statsHidden = false;
    localStorage.setItem(KEYS.STATS_HIDDEN, '0');
    applyStatsVis();
  };
}

// In-tab pre-roll buffer slider. 0 = Off (live edge). Read at play time.
function initBufferSlider() {
  const bufSlider = $('playback-buffer');
  const bufOut    = $('playback-buffer-out');
  if (!bufSlider) return;
  bufSlider.max = '60';
  const storedVal = parseInt(localStorage.getItem(KEYS.PLAYBACK_BUFFER) || '0', 10);
  bufSlider.value = String(Math.min(Math.max(storedVal, 0), 60));
  if (bufOut) bufOut.textContent = bufferLabel(bufSlider.value, 60);
  // Seed the server from localStorage on load so the aceman CLI's
  // buffer_secs isn't stale when the slider goes untouched.
  api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ buffer_secs: Math.min(Math.max(storedVal, 0), 60) }),
  }).catch(() => {});
  bufSlider.oninput = () => {
    const n = Math.min(Math.max(parseInt(bufSlider.value, 10), 0), 60);
    localStorage.setItem(KEYS.PLAYBACK_BUFFER, String(n));
    if (bufOut) bufOut.textContent = bufferLabel(n, 60);
  };
  // On release, persist server-side (config.json:buffer_secs) so the
  // aceman CLI applies the same seconds to the external player cache.
  bufSlider.onchange = () => {
    const n = Math.min(Math.max(parseInt(bufSlider.value, 10), 0), 60);
    api('/api/config', {
      method: 'POST', body: JSON.stringify({ buffer_secs: n }),
    }).catch(() => {});
    notifyRestartNeeded();   // buffer change applies on next stream start
  };
}
