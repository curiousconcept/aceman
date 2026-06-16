// Trailing-edge debounce. Standard primitive — kept here so the
// search input doesn't need to roll its own setTimeout dance.
//
// The factory takes `setTimeout` / `clearTimeout` for testability:
// production passes the real timers, tests pass deterministic
// stand-ins that record scheduled callbacks.

export function debounce(fn, ms, deps = {}) {
  const setT = deps.setTimeout ||
    (typeof setTimeout !== 'undefined' ? setTimeout : null);
  const clearT = deps.clearTimeout ||
    (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
  if (!setT || !clearT) {
    throw new Error('debounce: no timer functions available');
  }

  let token = null;
  const debounced = (...args) => {
    if (token !== null) clearT(token);
    token = setT(() => { token = null; fn(...args); }, ms);
  };
  debounced.cancel = () => {
    if (token !== null) { clearT(token); token = null; }
  };
  return debounced;
}
