"""The page is assembled from per-domain html/css partials spliced into
shell templates via @include markers (see aceman_web._expand_includes).
These tests guard the seam: every marker must resolve, nothing may leak
into the served page, and the headline content of each partial must be
present — so a dropped or misnamed partial fails loudly instead of
shipping a page with a missing card or stylesheet."""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import re
import unittest

import aceman_web

_HERE = pathlib.Path(aceman_web.__file__).resolve().parent
_INCLUDE = re.compile(r"@include[ \t]+(\S+?)[ \t]*(?:-->|\*/)")


class AssetAssemblyTests(unittest.TestCase):
    def setUp(self):
        # Re-assemble fresh rather than trust the import-time cache.
        self.html = aceman_web._expand_includes(
            (_HERE / "ui" / "index.html").read_text(encoding="utf-8"))
        self.css = aceman_web._expand_includes(
            (_HERE / "ui" / "style.css").read_text(encoding="utf-8"))

    def test_no_unresolved_markers(self):
        for blob in (self.html, self.css):
            self.assertNotIn("@include", blob)

    def test_every_shell_include_resolves_to_a_file(self):
        for shell in ("ui/index.html", "ui/style.css"):
            text = (_HERE / shell).read_text(encoding="utf-8")
            rels = _INCLUDE.findall(text)
            self.assertTrue(rels, f"{shell} has no @include markers")
            for rel in rels:
                self.assertTrue((_HERE / "ui" / rel).is_file(),
                                f"{shell}: missing partial {rel}")

    def test_served_page_has_no_leftover_sentinels(self):
        page = aceman_web._load_index_template()
        for sentinel in ("@include", "/*__ACEMAN_CSS_HERE__*/",
                         "//__ACEMAN_JS_HERE__", "__ACEMAN_BUILD__",
                         "__ACEMAN_COMMIT__"):
            self.assertNotIn(sentinel, page)

    def test_headline_content_from_each_partial_present(self):
        # One distinctive token per extracted partial — a dropped partial
        # (wrong path, bad cut) takes its token with it.
        for token in ('id="favs-card"', 'id="play-card"', 'id="player-card"',
                      'id="engine-card"', 'id="reset-modal"', 'id="restart-modal"',
                      'id="install-modal"', 'id="favname-modal"', 'id="busy-modal"',
                      'id="confirm-modal"', 'id="logs-viewer"', 'id="gpu-card"',
                      'id="dbg-overlay"', 'class="site-header"', 'id="notice-host"',
                      'id="container-mem-row"', 'id="factory-reset"'):
            self.assertIn(token, self.html, f"missing html: {token}")
        for token in ('.aceman-select-trigger', '.fav ', '.logs-tab', '.notice-host',
                      '#dbg-overlay', '#playback-buffer', '#play-btn', '.favname-opt',
                      '.aceman ', '#image-log', '.live-dot'):
            self.assertIn(token, self.css, f"missing css: {token}")


if __name__ == "__main__":
    unittest.main()
