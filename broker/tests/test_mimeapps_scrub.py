"""Tests for the mimeapps.list scrubber.

Security-critical property: we ONLY remove the scheme-handler line if
it points at OUR ``.desktop`` basename. A user who reassigned the
scheme to some other app (or whose distro pre-installed a different
acestream handler) must have that line preserved.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

from aceman_broker.mimeapps import (
    DESKTOP_BASENAME,
    render_install_entry,
    scrub_text,
)


class ScrubTextTests(unittest.TestCase):
    def test_strips_exact_line(self):
        src = (
            "[Default Applications]\n"
            "x-scheme-handler/acestream=aceman.desktop\n"
            "text/html=firefox.desktop\n"
        )
        out, changed = scrub_text(src)
        self.assertTrue(changed)
        self.assertNotIn("aceman.desktop", out)
        self.assertIn("firefox.desktop", out)

    def test_idempotent_when_absent(self):
        src = "[Default Applications]\ntext/html=firefox.desktop\n"
        out, changed = scrub_text(src)
        self.assertFalse(changed)
        self.assertEqual(out, src)

    def test_does_not_touch_other_handler(self):
        # User reassigned the scheme to ace-player; we must leave it.
        src = "x-scheme-handler/acestream=ace-player.desktop\n"
        out, changed = scrub_text(src)
        self.assertFalse(changed)
        self.assertEqual(out, src)

    def test_does_not_touch_other_handler_with_aceman_suffix(self):
        # Sub-string match would catch this; the anchored regex must not.
        src = "x-scheme-handler/acestream=not-aceman.desktop\n"
        out, changed = scrub_text(src)
        self.assertFalse(changed)
        self.assertEqual(out, src)

    def test_handles_trailing_semicolon(self):
        # mimeapps.list often has a trailing `;` after the value.
        src = "x-scheme-handler/acestream=aceman.desktop;\n"
        out, changed = scrub_text(src)
        self.assertTrue(changed)
        self.assertNotIn("aceman.desktop", out)

    def test_handles_whitespace_around_equals(self):
        src = "x-scheme-handler/acestream  =  aceman.desktop\n"
        out, changed = scrub_text(src)
        self.assertTrue(changed)
        self.assertNotIn("aceman.desktop", out)

    def test_only_strips_in_default_section(self):
        # Lines in [Added Associations] that ALSO reference aceman.desktop
        # are scrubbed too — they're our entries. The regex doesn't care
        # about section because mimeapps.list grammar lets the same key
        # appear in multiple sections.
        src = (
            "[Default Applications]\n"
            "x-scheme-handler/acestream=aceman.desktop\n"
            "\n"
            "[Added Associations]\n"
            "x-scheme-handler/acestream=aceman.desktop;\n"
        )
        out, changed = scrub_text(src)
        self.assertTrue(changed)
        self.assertNotIn("aceman.desktop", out)
        # Section headers must survive.
        self.assertIn("[Default Applications]", out)
        self.assertIn("[Added Associations]", out)

    def test_collapses_blank_runs(self):
        # After removing our line, we shouldn't pile up blank rows.
        src = (
            "a=b.desktop\n"
            "x-scheme-handler/acestream=aceman.desktop\n"
            "\n"
            "\n"
            "c=d.desktop\n"
        )
        out, _ = scrub_text(src)
        # No run of 3+ \n (which would be 2+ blank lines).
        self.assertNotIn("\n\n\n", out)

    def test_partial_line_does_not_match(self):
        # Substring "x-scheme-handler/acestream=aceman.desktop" embedded
        # mid-line (e.g. as a comment) must NOT match. Anchors are doing
        # the work.
        src = "# example: x-scheme-handler/acestream=aceman.desktop\n"
        out, changed = scrub_text(src)
        self.assertFalse(changed)
        self.assertEqual(out, src)

    def test_render_install_matches_scrub_pattern(self):
        # What the installer writes must be exactly what the scrubber
        # later matches. This is the round-trip invariant — if either
        # side drifts, factory reset would leave orphan handlers.
        entry = render_install_entry()
        out, changed = scrub_text(entry)
        self.assertTrue(changed)
        self.assertEqual(out.strip(), "")


if __name__ == "__main__":
    unittest.main()
