// Factory-reset feature: the confirm modal + the wipe call.
//
// Posts to /api/factory-reset (which tears down db + container), then
// renders the per-step report in the modal and offers a hard reload —
// the page is in an inconsistent state afterward, so a reload back to a
// known-good state is the cleanest exit.

import { $, showError } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { formatResetReport } from './lib/factory_reset_report.js';

export function openResetModal() {
  $('reset-modal').style.display = 'flex';
  $('reset-confirm-input').value = '';
  $('reset-go').disabled = true;
  $('reset-report').style.display = 'none';
  $('reset-report').textContent = '';
  setTimeout(() => $('reset-confirm-input').focus(), 0);
}

export function closeResetModal() { $('reset-modal').style.display = 'none'; }

export async function runFactoryReset() {
  const btn = $('reset-go');
  btn.disabled = true;
  btn.textContent = 'Wiping…';
  let report;
  try {
    report = await api('/api/factory-reset', {
      method: 'POST', body: JSON.stringify({ confirm: 'RESET' }),
    });
  } catch (e) {
    showError('factory reset: ' + e.message);
    btn.textContent = 'Wipe everything';
    return;
  }
  // Render the per-step report inside the modal so the user sees what
  // happened. The page itself is now in an inconsistent state (its db is
  // gone, its container is gone) — a hard reload after the user dismisses
  // the modal is the cleanest way back to a known-good state.
  $('reset-report').textContent = formatResetReport(report);
  $('reset-report').style.display = '';
  btn.textContent = 'Done — reload page';
  btn.disabled = false;
  btn.onclick = () => window.location.reload();
}
