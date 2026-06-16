// Pure formatter for the /api/factory-reset response body.
//
// The factory-reset endpoint returns:
//
//   {
//     steps: [
//       { name: 'stop engine', ok: true,  note: 'already stopped' },
//       { name: 'remove image', ok: false, error: 'image in use' },
//       ...
//     ],
//     kept: [
//       { path: '~/.cache/aceman/', reason: 'log files (post-mortem)' },
//     ],
//   }
//
// The original render inlined the per-line assembly and the
// optional "Kept:" footer into the DOM call site. Pulling the
// stringification out lets us pin the formatting rules with
// deterministic tests AND keeps the DOM render to a single
// `textContent` assignment.
//
// Pure. No DOM, no globals.

const CHECK = '✓';
const CROSS = '✗';

function formatStep(step) {
  if (!step || typeof step !== 'object') return '';
  const mark = step.ok ? CHECK : CROSS;
  const name = typeof step.name === 'string' ? step.name : '(unnamed step)';
  const note = step.note ? ` (${step.note})` : '';
  const err = step.error ? `\n    ${step.error}` : '';
  return `${mark} ${name}${note}${err}`;
}

function formatKept(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const path = entry.path || '';
  const reason = entry.reason || '';
  return `  ${path}\n    ${reason}`;
}

export function formatResetReport(report) {
  const r = report && typeof report === 'object' ? report : {};
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const kept = Array.isArray(r.kept) ? r.kept : [];

  const stepLines = steps.map(formatStep).filter(Boolean);
  let out = stepLines.join('\n');
  if (kept.length) {
    out += '\n\nKept:\n' + kept.map(formatKept).filter(Boolean).join('\n');
  }
  return out;
}
