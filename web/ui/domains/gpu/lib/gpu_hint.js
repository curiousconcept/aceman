// Pure builder for the "GPU encode unavailable" hint. The right driver
// package depends on which VA-API driver the probe found, so a single
// hardcoded suggestion is wrong half the time — Intel (iHD) and AMD
// (radeonsi) need different packages. Driver comes from the probe
// (caps.vaapi.driver). Split out so the per-driver text is unit-tested.

export function gpuEncodeHint(driver) {
  if (driver === 'iHD') {
    // Intel: distros often ship a codec-stripped iHD that hides H.264
    // encode. On Fedora the full driver is intel-media-driver-freeworld
    // (RPM Fusion); on Debian/Ubuntu it's intel-media-va-driver-non-free.
    return 'GPU encode unavailable — the Intel iHD driver found has no '
      + 'H.264 encoder (it may be a codec-stripped build). Install the '
      + 'full driver: intel-media-driver-freeworld (Fedora, via RPM Fusion) '
      + 'or intel-media-va-driver-non-free (Debian/Ubuntu).';
  }
  if (driver === 'radeonsi') {
    // AMD: Fedora's mesa-va-drivers has codecs stripped; the freeworld
    // build from RPM Fusion restores H.264.
    return 'GPU encode unavailable — install mesa-va-drivers-freeworld '
      + '(from RPM Fusion) so the AMD driver exposes H.264 encode.';
  }
  return 'GPU encode unavailable — install libva-utils + your GPU’s '
    + 'VA-API driver and confirm vainfo shows VAEntrypointEncSlice for H.264.';
}
