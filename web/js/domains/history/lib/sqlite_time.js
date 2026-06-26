// Format a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") as a local
// "YYYY-MM-DD HH:MM" string for the watch-history UI.
//
// SQLite stores stamps in UTC with a space separator and no zone. We
// turn the space into 'T' and append 'Z' so Date parses it as UTC,
// then render the viewer's LOCAL wall-clock (getHours/getMinutes).
//
// Defensive: empty / missing → ''. Unparseable → the first 16 chars of
// the raw stamp (i.e. "YYYY-MM-DD HH:MM" as stored) so the UI shows
// something rather than "Invalid Date".

export function formatSqliteUtcToLocal(stamp) {
  if (!stamp) return '';
  const raw = String(stamp);
  const d = new Date(raw.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return raw.slice(0, 16);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}
