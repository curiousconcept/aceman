// Pure helpers for the generic top-notice component (app.js showNotice).
//
// The DOM construction (createElement, host lookup, dismiss wiring)
// stays in app.js — it needs a live document. The decision bits worth
// pinning with deterministic tests live here.

// CSS class for a notice, with an optional variant modifier:
//   undefined/'' → 'notice'
//   'danger'     → 'notice notice--danger'
//   'go'         → 'notice notice--go'
export function noticeClassName(variant) {
  return 'notice' + (variant ? ' notice--' + variant : '');
}

// A notice renders its action button only when BOTH a non-empty label
// and a real click handler are supplied — guards against rendering a
// labelled-but-dead button (or a handler with no affordance).
export function noticeHasAction(actionLabel, onAction) {
  return !!actionLabel && typeof onAction === 'function';
}
