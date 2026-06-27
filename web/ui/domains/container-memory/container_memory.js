// Container-memory domain. Polls web + engine container memory every 8 s
// and paints the row below the Lifecycle buttons; each cell hides itself
// when its container isn't reporting. Within MEM_WARN_BYTES of the limit
// the cell warns and the label tooltip explains how to raise it.
import { $ } from '../../shared/dom.js';
import { formatBytes } from './lib/format_bytes.js';

const MEM_WARN_BYTES = 100 * 1024 * 1024;

function applyMemCell(cellId, displayId, hintId, envKey, data) {
  const cell = $(cellId);
  if (!cell) return;
  if (!data.available) { cell.style.display = 'none'; return; }
  const display = $(displayId);
  const hint    = $(hintId);
  if (display) display.textContent = `${formatBytes(data.mem_bytes)} / ${formatBytes(data.limit_bytes)}`;
  const nearLimit = data.limit_bytes > 0 &&
                    (data.limit_bytes - data.mem_bytes) < MEM_WARN_BYTES;
  cell.classList.toggle('mem-cell-warn', nearLimit);
  if (hint) {
    hint.textContent = nearLimit ? `— consider raising ${envKey}` : '';
    hint.style.display = nearLimit ? '' : 'none';
  }
  // Tooltip on the label span shows the current limit.
  const label = cell.querySelector('.tip');
  if (label && data.limit_bytes > 0) {
    const cur = formatBytes(data.limit_bytes);
    const cfgFile = '~/.config/aceman/env';
    label.dataset.tip =
      `Current limit: ${cur}\nTo change: add ${envKey}=2g to ${cfgFile}\nthen restart.`;
  }
  cell.style.display = '';
}

async function refreshContainerMemory() {
  const row = $('container-mem-row');
  if (!row) return;
  try {
    const [webMem, engMem] = await Promise.all([
      fetch('/api/web/memory').then(r => r.json()),
      fetch('/api/engine/memory').then(r => r.json()),
    ]);
    applyMemCell('web-mem-cell', 'web-mem-display', 'web-mem-hint', 'ACE_WEB_MEMORY', webMem);
    applyMemCell('eng-mem-cell', 'eng-mem-display', 'eng-mem-hint', 'ACE_MEMORY',     engMem);
    const anyVisible = ($('web-mem-cell') && $('web-mem-cell').style.display !== 'none')
                    || ($('eng-mem-cell') && $('eng-mem-cell').style.display !== 'none');
    row.style.display = anyVisible ? 'flex' : 'none';
  } catch (_) {
    if (row) row.style.display = 'none';
  }
}

export function initContainerMemory() {
  refreshContainerMemory();
  setInterval(refreshContainerMemory, 8000);
}
