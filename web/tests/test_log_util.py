"""Security tests for the terminal-safety and display-sanitisation
helpers.

These are the first line of defence against attacker-controlled bytes
reaching the operator's terminal (ANSI/CSI escape sequences, bidi
reordering of log lines) or the user's browser (text-content spoofing
with zero-width and bidi codepoints). Every regression here is a real
hazard, so the tests are exhaustive about the dangerous ranges and
exhaustive about the *allowed* characters not being mangled.
"""

from __future__ import annotations

from . import _setup  # noqa: F401 — path fix

import unittest

from aceman.log_util import (
    _DISPLAY_DANGEROUS,
    _TERMINAL_DANGEROUS,
    _sanitize_msg,
    _terminal_safe,
)


class TerminalSafeTests(unittest.TestCase):
    """``_terminal_safe`` escapes (not strips) so a forensic look at
    the log can still see what came through."""

    def test_plain_ascii_unchanged(self):
        self.assertEqual(_terminal_safe("hello world"), "hello world")

    def test_tab_kept(self):
        # TAB (0x09) is whitelisted because it's used by the favourites
        # file column separator and benign in stderr.
        self.assertEqual(_terminal_safe("a\tb"), "a\tb")

    def test_newline_escaped(self):
        # Newline can split a log line and forge a fake follow-up entry.
        self.assertEqual(_terminal_safe("a\nb"), "a\\u000ab")

    def test_carriage_return_escaped(self):
        # CR overwrites the current line — classic log injection.
        self.assertEqual(_terminal_safe("safe\rEVIL"), "safe\\u000dEVIL")

    def test_esc_escaped(self):
        # ESC (0x1B) is the start of ANSI/CSI/OSC sequences.
        self.assertEqual(
            _terminal_safe("\x1b[31mRED\x1b[0m"),
            "\\u001b[31mRED\\u001b[0m",
        )

    def test_del_and_c1_escaped(self):
        for cp in (0x7f, 0x80, 0x9b, 0x9f):
            with self.subTest(cp=cp):
                src = f"x{chr(cp)}y"
                self.assertNotIn(chr(cp), _terminal_safe(src))

    def test_bidi_override_escaped(self):
        # U+202E RIGHT-TO-LEFT OVERRIDE visually reorders the line
        # so e.g. "rm -rf /‮H.exe" prints as "rm -rf /exe.H".
        out = _terminal_safe("ok‮EVIL")
        self.assertNotIn("‮", out)
        self.assertIn("\\u202e", out)

    def test_lrm_rlm_escaped(self):
        for cp in (0x200e, 0x200f):
            with self.subTest(cp=cp):
                out = _terminal_safe("a" + chr(cp) + "b")
                self.assertNotIn(chr(cp), out)

    def test_word_joiner_escaped(self):
        out = _terminal_safe("a⁠b")
        self.assertEqual(out, "a\\u2060b")

    def test_bom_escaped(self):
        out = _terminal_safe("a﻿b")
        self.assertEqual(out, "a\\ufeffb")

    def test_letter_from_arbitrary_script_kept(self):
        # Cyrillic, CJK, Arabic letters must pass through unchanged —
        # we only block control bytes and spoofing chars, not scripts.
        for ch in ("Матч", "中文", "العربية"):
            with self.subTest(ch=ch):
                self.assertEqual(_terminal_safe(ch), ch)

    def test_idempotent_over_safe_input(self):
        s = "regular log line: 1234 ok"
        self.assertEqual(_terminal_safe(_terminal_safe(s)), _terminal_safe(s))


class DisplayDangerousTests(unittest.TestCase):
    """``_sanitize_msg`` STRIPS rather than escapes — the user sees
    an error message that's already context, no value in the raw
    bytes — then caps length so a hostile upstream can't dump a
    multi-MB blob into the error toast."""

    def test_strips_controls(self):
        out = _sanitize_msg("ok\x00\x07\x1b[31mEVIL\x1b[0m")
        self.assertEqual(out, "ok[31mEVIL[0m")

    def test_strips_zero_width_chars(self):
        # ZWSP makes "SkySports" and "Sky​Sports" indistinguishable
        # visually but distinct as identifiers — spoofing aid.
        for cp in (0x200b, 0x200c, 0x200d, 0x2060, 0xfeff):
            with self.subTest(cp=cp):
                out = _sanitize_msg(f"hello{chr(cp)}world")
                self.assertEqual(out, "helloworld")

    def test_strips_bidi_override(self):
        out = _sanitize_msg("safe‮EVIL")
        self.assertNotIn("‮", out)

    def test_strips_bidi_isolates(self):
        for cp in range(0x2066, 0x206a):
            with self.subTest(cp=cp):
                self.assertNotIn(chr(cp), _sanitize_msg("a" + chr(cp) + "b"))

    def test_caps_length_at_300(self):
        long = "A" * 1000
        self.assertEqual(len(_sanitize_msg(long)), 300)

    def test_keeps_safe_punctuation_and_letters(self):
        s = "Cannot connect: refused (errno=111). Retry?"
        self.assertEqual(_sanitize_msg(s), s)


class RegexCompiledCorrectlyTests(unittest.TestCase):
    """Spot checks on the regex objects themselves to catch a future
    typo that would silently widen the dangerous set or shrink it."""

    def test_terminal_dangerous_matches_esc(self):
        self.assertTrue(_TERMINAL_DANGEROUS.search("\x1b"))

    def test_terminal_dangerous_does_not_match_tab(self):
        self.assertIsNone(_TERMINAL_DANGEROUS.search("\t"))

    def test_display_dangerous_matches_tab(self):
        # Display path strips TAB (the favourites file column separator
        # would otherwise let a hostile name collide on storage).
        self.assertTrue(_DISPLAY_DANGEROUS.search("\t"))


if __name__ == "__main__":
    unittest.main()
