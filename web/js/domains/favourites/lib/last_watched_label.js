// Human-friendly "watched N days ago" label for the favourites list.
//
// Two timestamp shapes are accepted:
//   - SQLite gives 'YYYY-MM-DD HH:MM:SS' (UTC, no Z). We treat the
//     space as the date/time separator and pin the zone explicitly.
//   - localStorage gives a full ISO string with timezone.
//
// `now` is injectable for tests so we don't have to fight the wall clock.
//
// Pure. No DOM, no globals (apart from Date / Date.now via the override).

export function daysSinceLabel(stamp, now = Date.now()) {
  if (!stamp) return 'never watched';
  const d = /Z|[+-]\d\d:?\d\d$/.test(stamp)
    ? new Date(stamp)
    : new Date(stamp.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days <= 0) return 'watched today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
