// Pure mapping for the Play / Stop button state.
//
// The button toggles between ▶ (idle) and ⏹ (something playing
// anywhere — this tab, another browser, or an external player).
// Three attributes change together: textContent, title, and the
// `.playing` class. Splitting the policy out lets the DOM render
// be a 4-line apply loop.
//
// Pure. No DOM, no globals.

export function describePlayButton(isPlaying) {
  if (isPlaying) {
    return {
      text: '⏹',
      title: 'Stop',
      ariaLabel: 'Stop',
      playingClass: true,
    };
  }
  return {
    text: '▶',
    title: 'Play',
    ariaLabel: 'Play',
    playingClass: false,
  };
}
