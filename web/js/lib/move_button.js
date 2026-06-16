// Pure mapping for the "Move current stream → X" button.
//
// The button is visible only when:
//   1) something is actually playing (livePlaybackTarget is set), AND
//   2) the user has picked a different destination in the
//      dropdown (selectedValue !== livePlaybackTarget).
// Both clauses matter — without (1) we'd offer to move nothing
// after a Stop; without (2) we'd suggest a no-op.
//
// describeMoveButton() returns { visible, text }. The DOM render
// reads those two fields and is done.
//
// Pure. No DOM, no globals.

export function describeMoveButton(livePlaybackTarget, selectedValue, selectedLabel) {
  if (!livePlaybackTarget) return { visible: false, text: '' };
  if (!selectedValue || selectedValue === livePlaybackTarget) {
    return { visible: false, text: '' };
  }
  // Caller passes the dropdown's currently-selected label so we
  // can render `Move current stream → <label>`. If the caller
  // can't fetch the label, fall back to the raw value — still
  // legible, just less pretty.
  const dest = selectedLabel || selectedValue;
  return { visible: true, text: `Move current stream → ${dest}` };
}
