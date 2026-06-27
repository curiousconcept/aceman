// GPU Acceleration card.
//
// Probes /api/gpu/status, renders the card (backend chip, encode/filter
// controls), persists the user's choices to localStorage, and builds the
// query-string fragment the in-browser proxy URL appends. The pure
// param-building logic lives in lib/gpu/gpu_params.js (unit-tested);
// this is the DOM wiring + persistence.

import { $ } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { mountAcemanSelect } from '../../shared/dropdown.js';
import { notifyRestartNeeded } from '../playback/index.js';
import { KEYS } from '../../lib/storage_keys.js';
import { gpuQueryParams } from './lib/gpu_params.js';
import { gpuEncodeHint } from './lib/gpu_hint.js';

let _gpuCaps = null;  // populated by initGpuCard() at startup

function _loadGpuSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.GPU_ACCEL) || '{}');
  } catch (_) { return {}; }
}

function _saveGpuSettings(s) {
  localStorage.setItem(KEYS.GPU_ACCEL, JSON.stringify(s));
}

// Returns query-string fragment (e.g. "&gpu_backend=nvidia&gpu_enc=1")
// to append to the proxy URL. Empty string when nothing is enabled.
// Pure logic lives in lib/gpu/gpu_params.js (tested there); this wires
// it to the live capability probe + saved settings.
export function buildGpuParams() {
  return gpuQueryParams(_gpuCaps, _loadGpuSettings());
}

// The encode-path label shown in the in-browser status line: 'NVENC' /
// 'VA-API' when GPU H.264 encode is actually active for the current
// settings, else 'CPU'. Computed from the live caps + saved settings so
// it reflects what was really sent to the proxy.
export function gpuEncodeLabel() {
  const s = _loadGpuSettings();
  const h264Ok = _gpuCaps && (_gpuCaps.nvidia || (_gpuCaps.vaapi && _gpuCaps.vaapi.h264_enc));
  const backend = _gpuCaps && _gpuCaps.nvidia ? 'nvidia'
                : _gpuCaps && _gpuCaps.vaapi ? 'vaapi' : null;
  if (backend && s.encode && h264Ok) return backend === 'nvidia' ? 'NVENC' : 'VA-API';
  return 'CPU';
}

export async function initGpuCard() {
  let caps;
  try {
    caps = await api('/api/gpu/status');
  } catch (_) { return; }
  _gpuCaps = caps;

  const card = $('gpu-card');
  if (!card) return;
  card.style.display = '';

  if (!caps.available) {
    $('gpu-unavailable').style.display = '';
    return;
  }

  $('gpu-controls').style.display = '';

  // Show detected backend as a green status chip at the end of the controls row.
  const backendLabel = $('gpu-backend-label');
  if (caps.nvidia) {
    backendLabel.textContent = 'NVIDIA';
    backendLabel.className = 'status ok';
  } else if (caps.vaapi) {
    backendLabel.textContent = caps.qsv ? 'QSV' : 'VA-API';
    backendLabel.className = 'status ok';
  }

  // VA-API: if h264_enc is false, vainfo is missing or the driver doesn't
  // report H.264 encode support. Disable encode + warn; filters (deinterlace,
  // scale) still work independently via the vaapi filter chain.
  const h264Ok = caps.nvidia || (caps.vaapi && caps.vaapi.h264_enc);
  const encodeEl = $('gpu-encode');
  if (!h264Ok) {
    encodeEl.disabled = true;
    $('gpu-hint').textContent = gpuEncodeHint(caps.vaapi && caps.vaapi.driver);
  }

  // Wrap the upscale select with the same custom widget used for
  // Play-in so it matches the UI theme instead of the OS native picker.
  mountAcemanSelect($('gpu-upscale'));

  // Restore saved settings.
  const s = _loadGpuSettings();
  encodeEl.checked             = !!s.encode && h264Ok;
  $('gpu-deinterlace').checked = !!s.deinterlace;
  $('gpu-upscale').value       = s.scale || '';
  _refreshUpscaleNote();

  // Persist on change.
  const persist = () => {
    _saveGpuSettings({
      encode:      $('gpu-encode').checked,
      deinterlace: $('gpu-deinterlace').checked,
      scale:       $('gpu-upscale').value,
    });
    _refreshUpscaleNote();
    notifyRestartNeeded();   // GPU change applies on next stream start
  };
  $('gpu-encode').onchange      = persist;
  $('gpu-deinterlace').onchange = persist;
  $('gpu-upscale').onchange     = persist;
}

function _refreshUpscaleNote() {
  const note = $('gpu-upscale-note');
  if (note) note.style.display = $('gpu-upscale').value ? '' : 'none';
}
