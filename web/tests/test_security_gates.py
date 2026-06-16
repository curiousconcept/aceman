"""Cross-cutting handler security tests.

These exercise gates that aren't on the per-route logic but on the
Handler itself: DNS-rebinding protection, CSRF preflight gate, static
allow-list, body size cap, allowed-hosts builder. We don't spin up a
real socket; we test the gate functions directly with synthetic input.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import json
import unittest

import aceman_web


def _make_handler_stub(host_header: str = "127.0.0.1:8770",
                       content_type: str = "application/json",
                       allowed=None) -> aceman_web.Handler:
    """Build a Handler instance without going through __init__ (which
    expects a live request socket). We only use the per-instance bits
    the gate methods touch: ``headers`` and the class attribute
    ``Handler.allowed_hosts``."""
    H = aceman_web.Handler
    inst = object.__new__(H)
    # headers is a mapping with .get(name, default)
    class _Hdr(dict):
        def get(self, k, default=None):
            return dict.get(self, k, default)
    inst.headers = _Hdr({"Host": host_header,
                         "Content-Type": content_type})
    return inst


class BuildAllowedHostsTests(unittest.TestCase):
    """The Host-header allow-list construction is the kernel of the
    DNS-rebinding defence. A regression that adds an over-broad name
    here breaks the entire posture."""

    def test_loopback_emits_three_bases(self):
        out = aceman_web._build_allowed_hosts("127.0.0.1", 8770)
        # Both unported and ported variants of all three loopback names.
        for h in ("127.0.0.1", "localhost", "[::1]",
                  "127.0.0.1:8770", "localhost:8770", "[::1]:8770"):
            with self.subTest(h=h):
                self.assertIn(h, out)

    def test_zero_zero_disables_check(self):
        # 0.0.0.0 = "admin opted into LAN exposure"; we don't try to
        # police Host headers in that mode.
        self.assertIsNone(aceman_web._build_allowed_hosts("0.0.0.0", 8770))

    def test_non_loopback_narrow_allow_list(self):
        out = aceman_web._build_allowed_hosts("192.168.1.10", 8770)
        # Only the configured host, with and without the port.
        self.assertEqual(out, {"192.168.1.10", "192.168.1.10:8770"})

    def test_does_not_emit_wildcard(self):
        out = aceman_web._build_allowed_hosts("127.0.0.1", 8770)
        for evil in ("*", "", ".", "evil.com",
                     "127.0.0.1.evil.com", "127.0.0.1@evil.com"):
            with self.subTest(evil=evil):
                self.assertNotIn(evil, out)


class HostHeaderGateTests(unittest.TestCase):
    """``_host_allowed`` is the runtime check. The browser sends the
    Host header it believes it's talking to; if it doesn't match what
    we bound, refuse."""

    def setUp(self):
        self._saved = aceman_web.Handler.allowed_hosts
        aceman_web.Handler.allowed_hosts = {"127.0.0.1", "127.0.0.1:8770"}

    def tearDown(self):
        aceman_web.Handler.allowed_hosts = self._saved

    def test_matching_host_allowed(self):
        h = _make_handler_stub(host_header="127.0.0.1:8770")
        self.assertTrue(h._host_allowed())

    def test_non_matching_host_refused(self):
        for bad in ("evil.com", "evil.com:8770",
                    "127.0.0.1.evil.com", "127.0.0.1:8770.evil.com",
                    "[2001:db8::1]"):
            h = _make_handler_stub(host_header=bad)
            with self.subTest(bad=bad):
                self.assertFalse(h._host_allowed())

    def test_empty_host_refused(self):
        h = _make_handler_stub(host_header="")
        self.assertFalse(h._host_allowed())

    def test_when_allowed_hosts_is_none_anything_passes(self):
        # 0.0.0.0 bind sets allowed_hosts=None — admin opted out.
        aceman_web.Handler.allowed_hosts = None
        h = _make_handler_stub(host_header="anything-goes")
        self.assertTrue(h._host_allowed())


class ContentTypeGateTests(unittest.TestCase):
    def test_application_json_passes(self):
        h = _make_handler_stub(content_type="application/json")
        self.assertTrue(h._content_type_json())

    def test_application_json_with_charset_passes(self):
        h = _make_handler_stub(content_type="application/json; charset=utf-8")
        self.assertTrue(h._content_type_json())

    def test_text_plain_refused(self):
        # CORS safelist: text/plain reaches us WITHOUT preflight. We
        # MUST refuse it on mutating endpoints; otherwise a cross-origin
        # attacker can send a state-changing request.
        h = _make_handler_stub(content_type="text/plain")
        self.assertFalse(h._content_type_json())

    def test_form_urlencoded_refused(self):
        h = _make_handler_stub(
            content_type="application/x-www-form-urlencoded")
        self.assertFalse(h._content_type_json())

    def test_multipart_refused(self):
        h = _make_handler_stub(content_type="multipart/form-data; boundary=x")
        self.assertFalse(h._content_type_json())

    def test_missing_content_type_refused(self):
        # Manually drop the Content-Type header.
        h = _make_handler_stub()
        # Re-create headers without Content-Type.
        class _Hdr(dict):
            def get(self, k, default=None): return dict.get(self, k, default)
        h.headers = _Hdr({"Host": "127.0.0.1"})
        self.assertFalse(h._content_type_json())

    def test_case_insensitive(self):
        h = _make_handler_stub(content_type="Application/JSON")
        self.assertTrue(h._content_type_json())


class StaticAllowListTests(unittest.TestCase):
    """The static file handler matches names against an allow-list — a
    request for ``../etc/passwd`` (or its URL-encoded form) must never
    reach a filesystem read."""

    def test_known_static_files_present(self):
        # The allow-list IS the static surface. If a name appears in
        # the test but not here, it's not actually servable.
        from aceman_web import Handler
        for name in ("mpegts.min.js", "favicon.ico"):
            with self.subTest(name=name):
                self.assertIn(name, Handler._STATIC_FILES)

    def test_traversal_names_not_in_list(self):
        from aceman_web import Handler
        for bad in ("../etc/passwd",
                    "..%2Fetc%2Fpasswd",
                    "../../aceman_web.py",
                    "aceman_web.py",
                    ".env",
                    "config.json",
                    ""):
            with self.subTest(bad=bad):
                self.assertNotIn(bad, Handler._STATIC_FILES)

    def test_static_value_is_pure_relative_path(self):
        # No absolute paths, no `..`, no schemes — even a future-author
        # mistake here can't smuggle a path that escapes web/.
        from aceman_web import Handler
        for _name, (_ct, rel) in Handler._STATIC_FILES.items():
            with self.subTest(rel=rel):
                self.assertFalse(rel.startswith("/"))
                self.assertNotIn("..", rel.split("/"))
                self.assertFalse(rel.startswith("file:"))


class IsAcemanAtTests(unittest.TestCase):
    """The takeover guard (``_is_aceman_at``) is what stops the
    --takeover wrapper from accidentally shutting down something
    that isn't us when the port is held by an unrelated process.

    We can't run a real socket here — but we can confirm a refused
    connection returns False (best signal a port isn't ours)."""

    def test_refused_connection_returns_false(self):
        # Port 1 is reserved + privileged + closed for non-root.
        self.assertFalse(aceman_web._is_aceman_at("127.0.0.1", 1))

    def test_garbage_host_returns_false(self):
        # Hostname doesn't resolve → False, not raise.
        self.assertFalse(
            aceman_web._is_aceman_at(
                "definitely-not-a-real-host.invalid", 65000))


if __name__ == "__main__":
    unittest.main()
