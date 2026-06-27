// Tests for the desktop-entry status → display-fields mapping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDesktopShortcutStatus } from '../domains/desktop/lib/desktop_shortcut_status.js';

test('null input → unavailable card with disabled Install button', () => {
  const v = describeDesktopShortcutStatus(null);
  assert.equal(v.status, 'unavailable');
  assert.equal(v.statusClass, 'status bad');
  assert.equal(v.button.disabled, true);
  // Even disabled, the button shows the action it WOULD perform.
  assert.equal(v.button.action, 'install');
  assert.equal(v.button.text, 'Install');
  assert.equal(v.path, '');
});

test('installed → Uninstall button styled as danger-outline', () => {
  const v = describeDesktopShortcutStatus({
    installed: true, path: '/home/user/.local/share/applications/aceman.desktop',
  });
  assert.equal(v.status, 'installed');
  assert.equal(v.statusClass, 'status ok');
  assert.equal(v.button.text, 'Uninstall');
  assert.equal(v.button.action, 'uninstall');
  assert.equal(v.button.className, 'danger-outline');
  assert.equal(v.button.disabled, false);
  assert.equal(v.path, '/home/user/.local/share/applications/aceman.desktop');
});

test('not installed → Install button styled as primary', () => {
  const v = describeDesktopShortcutStatus({
    installed: false, path: '/home/user/.local/share/applications/aceman.desktop',
  });
  assert.equal(v.status, 'not installed');
  assert.equal(v.statusClass, 'status');
  assert.equal(v.button.text, 'Install');
  assert.equal(v.button.action, 'install');
  assert.equal(v.button.className, 'primary');
  assert.equal(v.button.disabled, false);
});

test('missing path → empty string (no crash, no "undefined" in DOM)', () => {
  const v = describeDesktopShortcutStatus({ installed: true });
  assert.equal(v.path, '');
});

test('UNAVAILABLE result is frozen — callers cannot mutate the shared default', () => {
  const v = describeDesktopShortcutStatus(null);
  assert.throws(() => { v.button.disabled = false; });
});

test('install vs uninstall actions never collide on disabled state', () => {
  // The button.action field is what toggleDesktopEntry() switches
  // on. Pin the round-trip so a refactor can't accidentally pair
  // text="Install" with action="uninstall".
  const installed = describeDesktopShortcutStatus({ installed: true });
  assert.equal(installed.button.action, 'uninstall');
  assert.equal(installed.button.text, 'Uninstall');

  const notInstalled = describeDesktopShortcutStatus({ installed: false });
  assert.equal(notInstalled.button.action, 'install');
  assert.equal(notInstalled.button.text, 'Install');
});

test('explicit installed=false matches not-installed branch', () => {
  // Defensive — make sure the truthiness check on `installed`
  // handles the typical false vs the missing-key case identically.
  const a = describeDesktopShortcutStatus({ installed: false });
  const b = describeDesktopShortcutStatus({});
  assert.equal(a.status, b.status);
  assert.equal(a.button.action, b.button.action);
});
