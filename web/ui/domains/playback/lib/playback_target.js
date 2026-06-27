// Playback-target encoding helpers.
//
// The Player dropdown packs three target classes into one option
// value so the change handler can switch on a single string:
//
//   ""                      — nothing selected / no default known
//   "browser"               — this tab (in-page mpegts.js player)
//   "browser|name|source"   — open a new window in a specific browser
//                             which then auto-plays in its own tab
//   "external|name|source"  — VLC/mpv via the acestream:// scheme
//
// `name` and `source` come from the host-side player/browser probes
// (see broker/aceman_broker/actions/{players,browsers}.py). Either
// can be empty — we still encode the kind so callers can branch.
//
// Pure. No DOM, no globals.

export function encodeTarget(kind, name, source) {
  if (kind !== 'browser' && kind !== 'external') {
    throw new Error(`encodeTarget: unknown kind '${kind}'`);
  }
  if (!name) {
    return kind === 'browser' ? 'browser' : '';
  }
  return `${kind}|${name}|${source || ''}`;
}

export function parseTarget(value) {
  if (!value) return { kind: '', name: '', source: '' };
  if (value === 'browser') return { kind: 'browser', name: '', source: '' };
  const [kind, name, source] = String(value).split('|');
  if (kind !== 'browser' && kind !== 'external') {
    return { kind: '', name: '', source: '' };
  }
  return { kind, name: name || '', source: source || '' };
}

export function isExternal(value) {
  return parseTarget(value).kind === 'external';
}

export function isBrowser(value) {
  return parseTarget(value).kind === 'browser';
}

// True for the bare 'browser' value (this tab, no specific browser
// targeted). Useful when callers need to distinguish "stay here" from
// "open in named browser X".
export function isBareBrowser(value) {
  return value === 'browser';
}
