// Human-readable byte size. GiB keeps 2 decimals (the figures that
// matter for a memory limit); MiB/KiB round to whole units.
export function formatBytes(b) {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GiB';
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(0) + ' MiB';
  if (b >= 1024)      return (b / 1024).toFixed(0) + ' KiB';
  return b + ' B';
}
