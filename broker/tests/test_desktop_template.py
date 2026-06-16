"""Tests for the Desktop Entry generator.

The ``Exec=`` line is re-parsed by xdg-open / glib using a shell-ish
grammar. Each test pins one of the four escape rules
(backslash / double-quote / backtick / dollar) plus a small set of
worked examples that the spec hands you.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

from aceman_broker.desktop_helpers import desktop_quote_arg
from aceman_broker.desktop_template import (
    DESKTOP_SCHEME_HANDLER,
    render_desktop_entry,
)


class DesktopQuoteArgTests(unittest.TestCase):
    def test_always_quoted(self):
        out = desktop_quote_arg("plain")
        self.assertTrue(out.startswith('"'))
        self.assertTrue(out.endswith('"'))

    def test_backslash_escaped(self):
        self.assertEqual(desktop_quote_arg(r"a\b"), r'"a\\b"')

    def test_double_quote_escaped(self):
        self.assertEqual(desktop_quote_arg('a"b'), r'"a\"b"')

    def test_backtick_escaped(self):
        self.assertEqual(
            desktop_quote_arg("a`whoami`b"), r'"a\`whoami\`b"')

    def test_dollar_escaped(self):
        # `$HOME` would otherwise be expanded by the launcher.
        self.assertEqual(desktop_quote_arg("$HOME"), r'"\$HOME"')

    def test_combined(self):
        out = desktop_quote_arg(r'$X "Y" `Z` \W')
        for must in (r"\$X", r'\"Y\"', r"\`Z\`", r"\\W"):
            with self.subTest(must=must):
                self.assertIn(must, out)


class DesktopTemplateTests(unittest.TestCase):
    def setUp(self):
        self.launcher = "/home/user/Projects/aceman/aceman_web"
        self.body = render_desktop_entry(self.launcher, "127.0.0.1", 8770)

    def test_has_required_keys(self):
        for key in ("Type=Application", "Name=aceman",
                    "Categories=AudioVideo;Player;Network;",
                    "StartupNotify=true",
                    f"MimeType={DESKTOP_SCHEME_HANDLER};"):
            with self.subTest(key=key):
                self.assertIn(key, self.body)

    def test_exec_quotes_launcher(self):
        # The launcher path is always wrapped in double quotes — even
        # though this path has no spaces, always-quoting is the safe
        # default.
        self.assertIn(f'Exec="{self.launcher}"', self.body)

    def test_exec_quotes_host(self):
        self.assertIn('--host "127.0.0.1"', self.body)

    def test_exec_does_not_quote_port(self):
        self.assertIn("--port 8770", self.body)

    def test_exec_ends_with_url_placeholder(self):
        # %u is the xdg-open URL placeholder. Must be the LAST item so
        # the URL ends up as the final argv element (and so a malformed
        # URL can't shift the meaning of preceding flags).
        for line in self.body.splitlines():
            if line.startswith("Exec="):
                self.assertTrue(line.endswith(" %u"),
                                f"unexpected exec tail: {line!r}")
                break
        else:
            self.fail("no Exec= line in output")

    def test_container_flag_optional(self):
        body_no = render_desktop_entry(self.launcher, "h", 80, container=False)
        body_yes = render_desktop_entry(self.launcher, "h", 80, container=True)
        self.assertNotIn("--container", body_no)
        self.assertIn("--container", body_yes)

    def test_hostile_host_cannot_break_out_of_quotes(self):
        # Even if validate_host let a bad value slip past (it
        # shouldn't), the QUOTING here must keep the Exec= line
        # well-formed: the double-quote in the value must be
        # backslash-escaped, not closing the field.
        body = render_desktop_entry(
            self.launcher, 'evil"; rm -rf /; "',  # would close + inject
            8770)
        # The result MUST contain the escaped double-quote.
        self.assertIn(r'\"', body)
        # And MUST NOT contain a bare `; rm -rf /; `-style break.
        # Bare double-quote followed by semicolon (without the
        # preceding backslash) would be the smoking gun.
        for line in body.splitlines():
            if line.startswith("Exec="):
                self.assertNotIn('"; rm', line.replace(r'\"; rm', ""))

    def test_hostile_dollar_escaped(self):
        body = render_desktop_entry(
            self.launcher, "$EVIL", 8770)
        # Find Exec= line and confirm `$EVIL` is escaped.
        for line in body.splitlines():
            if line.startswith("Exec="):
                self.assertIn(r"\$EVIL", line)
                break

    def test_hostile_backtick_escaped(self):
        body = render_desktop_entry(
            self.launcher, "`whoami`", 8770)
        for line in body.splitlines():
            if line.startswith("Exec="):
                self.assertIn(r"\`whoami\`", line)
                break


if __name__ == "__main__":
    unittest.main()
