// Pure builder for the GPU query-string fragment appended to the
// in-browser proxy URL (e.g. "&gpu_backend=vaapi&gpu_enc=1&gpu_scale=1080").
//
// Split out of app.js's buildGpuParams() so the backend-selection and
// H.264-encode gating can be pinned with deterministic tests. The app
// wrapper feeds it the live capability probe (_gpuCaps, from
// /api/gpu/status) and the saved settings (localStorage KEYS.GPU_ACCEL);
// everything here is a pure function of those two inputs.
//
// caps shape (from the broker /api/gpu/status reply):
//   { available: bool, nvidia: bool, qsv: bool,
//     vaapi: { h264_enc: bool } | falsy }
// settings shape:
//   { encode: bool, deinterlace: bool, scale: string }
//
// Backend precedence: nvidia > qsv > vaapi. Encode is additionally
// gated on H.264 encode support (always present on nvidia; on VA-API
// only when vainfo reported VAEntrypointEncSlice for H.264). Returns
// '' when GPU accel is unavailable or nothing is enabled.

export function gpuQueryParams(caps, settings) {
  if (!caps || !caps.available) return '';
  const s = settings || {};
  if (!s.encode && !s.deinterlace && !s.scale) return '';

  const backend = caps.nvidia ? 'nvidia'
                : caps.vaapi  ? (caps.qsv ? 'qsv' : 'vaapi')
                : null;
  if (!backend) return '';

  const h264Ok = !!(caps.nvidia || (caps.vaapi && caps.vaapi.h264_enc));
  let p = `&gpu_backend=${backend}`;
  if (s.encode && h264Ok) p += '&gpu_enc=1';
  if (s.deinterlace)      p += '&gpu_dei=1';
  if (s.scale)            p += `&gpu_scale=${s.scale}`;
  return p;
}
