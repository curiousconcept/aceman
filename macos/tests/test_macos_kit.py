"""Tests for the macOS kit's testable, host-agnostic artifacts.

The kit is mostly host scaffolding (shell + a plist) validated on real
hardware — see HANDOFF.md. The two things with real, OS-independent
correctness we CAN assert here:

  1. The handler app's Info.plist declares the acestream:// URL scheme —
     if that line is wrong, LaunchServices never routes clicks to us, and
     the whole click-to-play feature is dead.
  2. Every .command / .sh script is syntactically valid bash — a broken
     quote means the script fails on the Mac with no Linux to catch it.

Both run on any OS (plistlib is stdlib; bash is present on macOS and CI).
Run from macos/:  python3 -m unittest tests.test_macos_kit
"""

from __future__ import annotations

import pathlib
import plistlib
import shutil
import subprocess
import unittest


KIT = pathlib.Path(__file__).resolve().parent.parent
PLIST = KIT / "internal" / "handler-Info.plist"


class HandlerPlistTests(unittest.TestCase):
    def setUp(self):
        with PLIST.open("rb") as f:
            self.pl = plistlib.load(f)

    def test_declares_acestream_url_scheme(self):
        url_types = self.pl.get("CFBundleURLTypes", [])
        schemes = [
            s
            for entry in url_types
            for s in entry.get("CFBundleURLSchemes", [])
        ]
        self.assertIn("acestream", schemes)

    def test_has_bundle_identifier(self):
        self.assertTrue(self.pl.get("CFBundleIdentifier", "").strip())

    def test_executable_matches_osacompile_default(self):
        # register-handler.command overwrites the osacompiled bundle's
        # plist with this file; the executable name must match what
        # osacompile produced ("applet"), or the bundle won't launch.
        self.assertEqual(self.pl.get("CFBundleExecutable"), "applet")

    def test_is_background_agent(self):
        # No Dock icon for a URL handler.
        self.assertTrue(self.pl.get("LSUIElement"))


class ScriptSyntaxTests(unittest.TestCase):
    """`bash -n` every shell script in the kit — parse, don't execute."""

    def _scripts(self):
        for pattern in ("*.command", "internal/*.command", "internal/*.sh"):
            yield from KIT.glob(pattern)

    @unittest.skipUnless(shutil.which("bash"), "bash not available")
    def test_all_scripts_parse(self):
        scripts = list(self._scripts())
        self.assertTrue(scripts, "no kit scripts found — wrong test root?")
        for script in scripts:
            with self.subTest(script=script.name):
                r = subprocess.run(
                    ["bash", "-n", str(script)],
                    capture_output=True, text=True,
                )
                self.assertEqual(
                    r.returncode, 0,
                    f"{script.name} failed bash -n:\n{r.stderr}",
                )


if __name__ == "__main__":
    unittest.main()
