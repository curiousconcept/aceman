"""Security tests for the Desktop Entry quote helper.

The Exec= line is re-parsed by xdg-open / glib using a shell-ish
grammar with these four metacharacters inside double quotes:
``\\``, ``"``, ``` ` ```, ``$``. Forgetting any one of them is a
code-injection vector at scheme-handler dispatch time. The helper has
exactly one job; the tests cover exactly that job.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

from aceman.desktop_helpers import _desktop_quote_arg


class DesktopQuoteArgTests(unittest.TestCase):
    def test_always_double_quoted(self):
        self.assertTrue(_desktop_quote_arg("plain").startswith('"'))
        self.assertTrue(_desktop_quote_arg("plain").endswith('"'))

    def test_escapes_backslash(self):
        self.assertEqual(_desktop_quote_arg(r"a\b"), r'"a\\b"')

    def test_escapes_double_quote(self):
        self.assertEqual(_desktop_quote_arg('a"b'), r'"a\"b"')

    def test_escapes_backtick(self):
        self.assertEqual(_desktop_quote_arg("a`whoami`b"), r'"a\`whoami\`b"')

    def test_escapes_dollar(self):
        # `$HOME` would otherwise be expanded by the launcher.
        self.assertEqual(_desktop_quote_arg("a$HOME"), r'"a\$HOME"')

    def test_handles_path_with_spaces(self):
        self.assertEqual(
            _desktop_quote_arg("/var/home/impact/Projects/My Project/bin"),
            '"/var/home/impact/Projects/My Project/bin"')

    def test_handles_combined_specials(self):
        out = _desktop_quote_arg(r'$X "Y" `Z` \W')
        # All four classes escaped, nothing else mangled.
        self.assertIn(r"\$X", out)
        self.assertIn(r'\"Y\"', out)
        self.assertIn(r"\`Z\`", out)
        self.assertIn(r"\\W", out)


if __name__ == "__main__":
    unittest.main()
