// Tiny modal-lifecycle runner.
//
// Every modal in the app — install picker, favourite-name picker,
// reset confirmation — repeats the same five steps:
//
//   1. show the overlay (`display: flex`)
//   2. wire button clicks → resolve(value)
//   3. wire Escape → resolve(null)
//   4. unwire everything on resolve
//   5. hide the overlay
//
// runModal() owns steps 1, 3, 4, 5; the caller's `setup(done)`
// function owns step 2. `setup` may return a cleanup function that
// runModal will call on close — useful when the caller registered
// event listeners on inner widgets that the overlay doesn't capture
// (e.g. an `<input>` keydown handler).
//
// Returns a Promise that resolves with whatever `done(...)` was
// called with. `done(null)` is the convention for "user cancelled".
//
// Tests can drive this with a hand-rolled fake DOM — see
// web/js_tests/modal.test.mjs. The runtime dependencies are kept
// narrow: `overlay.style.display`, plus `addEventListener` /
// `removeEventListener` on an event target you pass in.

export function runModal({ overlay, eventTarget }, setup) {
  if (!overlay) throw new Error('runModal: overlay element is required');
  const target = eventTarget ||
    (typeof document !== 'undefined' ? document : null);
  if (!target) throw new Error('runModal: no event target available');

  overlay.style.display = 'flex';
  return new Promise(resolve => {
    let setupCleanup = null;
    const done = choice => {
      overlay.style.display = 'none';
      target.removeEventListener('keydown', onKey);
      if (typeof setupCleanup === 'function') setupCleanup();
      resolve(choice);
    };
    const onKey = e => { if (e.key === 'Escape') done(null); };
    target.addEventListener('keydown', onKey);
    // Run the caller's setup AFTER the listeners are registered, so
    // anything setup() does (like focus()) sits inside the same
    // pumping cycle the close path will unwind from.
    setupCleanup = setup(done) || null;
  });
}
