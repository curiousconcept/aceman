// Custom dropdown — a drop-in overlay for a native <select>.
//
// Browsers — especially Firefox on Linux — render the native <select>
// popup using GTK/Qt, ignoring CSS for the option highlight (purple by
// default on most distros). We don't replace the <select>; we keep it
// in the DOM for accessibility + form semantics + the existing JS API
// (.value, .options, .selectedIndex, .onchange / .addEventListener
// 'change'), then overlay this widget driven by it.
//
// mountAcemanSelect(native) idempotently wraps the given <select> with
// a custom trigger + listbox. Rebuilds the listbox whenever the native
// options change (MutationObserver) so renderPlaybackTargets keeps
// being the single source of truth. Programmatic value assignment is
// caught by overriding the value setter on the instance — native
// <select> doesn't fire 'change' on `el.value = ...`, but we still
// need the trigger label to update.
//
// Only browser globals (document, MutationObserver, Event, MouseEvent)
// plus the pure key-intent helper from lib/. No app state.
import { dropdownKeyAction } from '../lib/dropdown_keys.js';

export function mountAcemanSelect(native) {
  if (!native || native._acemanMounted) return;
  native._acemanMounted = true;

  const wrap = document.createElement('span');
  wrap.className = 'aceman-select-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'aceman-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.className = 'aceman-select-label';
  trigger.appendChild(label);

  const listbox = document.createElement('div');
  listbox.className = 'aceman-select-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.hidden = true;

  native.parentNode.insertBefore(wrap, native);
  wrap.appendChild(trigger);
  wrap.appendChild(listbox);
  wrap.appendChild(native);
  native.classList.add('aceman-select-native');
  native.setAttribute('tabindex', '-1');
  native.setAttribute('aria-hidden', 'true');

  let focusedOption = null;

  function focusOption(o) {
    if (focusedOption) focusedOption.classList.remove('focused');
    if (o) {
      o.classList.add('focused');
      focusedOption = o;
      o.scrollIntoView({ block: 'nearest' });
    } else {
      focusedOption = null;
    }
  }

  function nextOption(from, dir) {
    let n = from;
    while (true) {
      n = dir > 0 ? n.nextElementSibling : n.previousElementSibling;
      if (!n) return null;
      if (n.classList.contains('aceman-select-option')
          && n.getAttribute('aria-disabled') !== 'true') return n;
    }
  }

  function firstOption() {
    return listbox.querySelector('.aceman-select-option:not([aria-disabled="true"])');
  }

  function buildOption(opt) {
    const o = document.createElement('div');
    o.className = 'aceman-select-option';
    o.setAttribute('role', 'option');
    o.dataset.value = opt.value;
    o.textContent = opt.textContent;
    if (opt.disabled) o.setAttribute('aria-disabled', 'true');
    if (opt.value === native.value) o.setAttribute('aria-selected', 'true');
    o.addEventListener('mousedown', (e) => {
      // mousedown not click — so the outside-click handler (also on
      // mousedown) doesn't fire first and close the listbox before
      // our click reaches us.
      e.preventDefault();
      if (opt.disabled) return;
      if (native.value !== opt.value) {
        native.value = opt.value;
        native.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
      trigger.focus();
    });
    o.addEventListener('mouseenter', () => focusOption(o));
    return o;
  }

  function rebuildOptions() {
    listbox.innerHTML = '';
    for (const node of native.children) {
      if (node.tagName === 'OPTGROUP') {
        const g = document.createElement('div');
        g.className = 'aceman-select-group';
        g.textContent = node.label;
        listbox.appendChild(g);
        for (const opt of node.children) listbox.appendChild(buildOption(opt));
      } else if (node.tagName === 'OPTION') {
        listbox.appendChild(buildOption(node));
      }
    }
    updateTriggerLabel();
    syncDisabled();
  }

  function updateTriggerLabel() {
    const sel = native.options[native.selectedIndex];
    label.textContent = sel ? sel.textContent : '';
    for (const o of listbox.querySelectorAll('.aceman-select-option')) {
      if (o.dataset.value === native.value) o.setAttribute('aria-selected', 'true');
      else o.removeAttribute('aria-selected');
    }
  }

  function syncDisabled() {
    trigger.disabled = native.disabled;
    if (native.disabled && !listbox.hidden) close();
  }

  function open() {
    if (native.disabled) return;
    listbox.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const sel = listbox.querySelector('[aria-selected="true"]:not([aria-disabled="true"])');
    focusOption(sel || firstOption());
    document.addEventListener('mousedown', onOutside, true);
  }
  function close() {
    listbox.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
    focusOption(null);
  }
  function onOutside(e) { if (!wrap.contains(e.target)) close(); }

  trigger.addEventListener('click', () => {
    if (listbox.hidden) open(); else close();
  });
  trigger.addEventListener('keydown', (e) => {
    const { action, preventDefault, dir } = dropdownKeyAction(e.key, !listbox.hidden);
    if (preventDefault) e.preventDefault();
    if (action === 'open') {
      open();
    } else if (action === 'move') {
      const next = focusedOption ? nextOption(focusedOption, dir) : firstOption();
      if (next) focusOption(next);
    } else if (action === 'select') {
      if (focusedOption) focusedOption.dispatchEvent(new MouseEvent('mousedown'));
    } else if (action === 'close') {
      close();
    }
  });

  // Mirror programmatic native.value = "..." into the trigger label
  // (the native <select> does NOT fire 'change' for programmatic
  // assignment, but our renderer does set sel.value to seed selection).
  const proto = Object.getPrototypeOf(native);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.configurable !== false) {
    Object.defineProperty(native, 'value', {
      get: desc.get,
      set(v) { desc.set.call(this, v); updateTriggerLabel(); },
      configurable: true,
    });
  }

  // Native options can be rebuilt by renderPlaybackTargets at any
  // time (e.g. when loadBrowsers resolves after loadPlayers); reflect
  // those changes into our listbox.
  const obs = new MutationObserver(rebuildOptions);
  obs.observe(native, { childList: true, subtree: true,
                        attributes: true,
                        attributeFilter: ['disabled', 'selected'] });

  rebuildOptions();
}
