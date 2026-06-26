// Engine-image management card: status badge + build log + install /
// uninstall (rebuild) controls. Polls every 1s while a build is in
// flight. The status→display-fields mapping is pure and unit-tested in
// lib/cards/container_image_status.js; this is the DOM + the calls.
//
// Reaches back into the engine card (refreshEngineStatus) so the
// Start-engine button's enabled-ness tracks image state — a transitional
// import from app.js until engine is its own module.

import { $, showError, showConfirm } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { describeContainerImageStatus } from './lib/container_image_status.js';
import { refreshEngineStatus } from '../playback/playback.js';

let imagePoll = null;

export async function refreshImageStatus() {
  let s = null;
  try { s = await api('/api/engine/image'); }
  catch (_) { /* leave s = null; describeContainerImageStatus collapses to 'unavailable' */ }

  const view = describeContainerImageStatus(s);

  // Top-line status badge + registry tag (the tag is broker-supplied
  // and only present in a successful fetch).
  $('image-status').textContent = view.status;
  $('image-status').className = view.statusClass;
  if (s) {
    $('image-tag').textContent = s.tag || '';
    if (s.tag) $('image-label').title = s.tag;
  }

  const ins = $('image-install');
  const un = $('image-uninstall');
  ins.textContent = view.installButton.text;
  ins.disabled = view.installButton.disabled;
  un.disabled = !view.uninstallEnabled;

  // Build log (auto-scrolled to the bottom so new lines are visible).
  const log = $('image-log');
  log.textContent = view.log.lines.join('\n');
  log.scrollTop = log.scrollHeight;
  const logWrap = $('image-log-wrap');
  if (logWrap) {
    logWrap.style.display = view.log.visible ? '' : 'none';
    logWrap.open = view.log.expanded;
  }

  // Error hint — only revealed when describeContainerImageStatus surfaced one.
  const hint = $('image-hint');
  if (view.errorHint) {
    hint.textContent = view.errorHint;
    hint.className = 'status bad';
    hint.style.display = '';
  } else {
    hint.textContent = '';
    hint.className = 'status';
    hint.style.display = 'none';
  }

  // Continue / stop the 1s poll while a build is in flight.
  if (view.pollAgain) {
    if (!imagePoll) imagePoll = setInterval(refreshImageStatus, 1000);
  } else if (imagePoll) {
    clearInterval(imagePoll); imagePoll = null;
  }

  // After every image-state change, refresh the engine status so the
  // Start-engine button's enabled-ness stays in sync.
  refreshEngineStatus();
}

export async function installImage() {
  try {
    await api('/api/engine/image', { method: 'POST' });
  } catch (e) {
    showError('image install: ' + e.message);
  }
  refreshImageStatus();
}

export async function uninstallImage() {
  if (!(await showConfirm({
    title: 'Uninstall engine image',
    message: 'Remove the engine container image? Any running container is stopped first.',
    confirmText: 'Uninstall',
    danger: true,
  }))) return;
  try {
    const r = await api('/api/engine/image', { method: 'DELETE' });
    if (r.removed === false) showError('image uninstall: ' + (r.error || 'failed'));
  } catch (e) {
    showError('image uninstall: ' + e.message);
  }
  refreshImageStatus();
}
