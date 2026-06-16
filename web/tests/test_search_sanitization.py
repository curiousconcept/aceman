"""Security tests for SearchProxy.

Upstream is treated as adversarial. Every refusal documented in the
SearchProxy docstring is checked here. We never make real network
calls — ``urllib.request.OpenerDirector.open`` is patched per test.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import io
import json
import socket
import unittest
import unittest.mock as mock
import urllib.error

from aceman.search import SearchError, SearchProxy


class _FakeResponse:
    """Stands in for an HTTPResponse for the `with opener.open(...)`
    pattern. BytesIO doesn't natively work as a context manager in a
    way that survives the `with` statement (Python looks up
    __enter__ on the type, not the instance), so we wrap it
    explicitly."""

    def __init__(self, payload, status: int = 200):
        if isinstance(payload, (dict, list)):
            payload = json.dumps(payload).encode("utf-8")
        elif isinstance(payload, str):
            payload = payload.encode("utf-8")
        self._buf = io.BytesIO(payload)
        self.status = status

    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self, n=-1): return self._buf.read(n)
    def getcode(self): return self.status


def _fake_body(payload, status: int = 200):
    return _FakeResponse(payload, status)


GOOD_CID = "a" * 40


class CleanQueryTests(unittest.TestCase):
    def test_strips_control_bytes(self):
        self.assertEqual(SearchProxy._clean_query("ok\x00bad"), "okbad")

    def test_strips_zero_width(self):
        self.assertEqual(SearchProxy._clean_query("a​b"), "ab")

    def test_strips_bidi_overrides(self):
        # LRE/RLE/PDF/LRO/RLO range
        for cp in range(0x202a, 0x202f):
            with self.subTest(cp=cp):
                out = SearchProxy._clean_query("x" + chr(cp) + "y")
                self.assertEqual(out, "xy")

    def test_caps_query_length(self):
        out = SearchProxy._clean_query("A" * 500)
        self.assertEqual(len(out), SearchProxy.MAX_QUERY_LEN)

    def test_non_string_becomes_empty(self):
        self.assertEqual(SearchProxy._clean_query(None), "")
        self.assertEqual(SearchProxy._clean_query(12345), "")
        self.assertEqual(SearchProxy._clean_query({"q": "x"}), "")


class CleanNameTests(unittest.TestCase):
    def test_keeps_letters_any_script(self):
        for s in ("Sky Sports", "Матч ТВ", "体育频道", "العربية"):
            with self.subTest(s=s):
                self.assertEqual(SearchProxy._clean_name(s), s)

    def test_strips_bidi_isolate(self):
        # LRI ⁦ … PDI ⁩ would let an upstream visually
        # reorder our row labels.
        out = SearchProxy._clean_name("⁦evil⁩")
        self.assertEqual(out, "evil")

    def test_caps_at_max_name_len(self):
        out = SearchProxy._clean_name("x" * 1000)
        self.assertEqual(len(out), SearchProxy.MAX_NAME_LEN)


class CleanItemTests(unittest.TestCase):
    def test_drops_non_dict(self):
        self.assertIsNone(SearchProxy._clean_item("string"))
        self.assertIsNone(SearchProxy._clean_item([1, 2, 3]))
        self.assertIsNone(SearchProxy._clean_item(42))

    def test_drops_bad_cid(self):
        self.assertIsNone(SearchProxy._clean_item(
            {"content_id": "not40hex", "name": "x"}))

    def test_drops_non_string_cid(self):
        self.assertIsNone(SearchProxy._clean_item(
            {"content_id": 12345, "name": "x"}))

    def test_drops_blank_names(self):
        self.assertIsNone(SearchProxy._clean_item(
            {"content_id": GOOD_CID, "name": "", "translated_name": ""}))

    def test_lowercases_cid(self):
        out = SearchProxy._clean_item(
            {"content_id": "A" * 40, "name": "X"})
        self.assertEqual(out["cid"], "a" * 40)


class SearchEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.sp = SearchProxy()
        self._patch = mock.patch.object(self.sp, "_opener")
        self.opener = self._patch.start()
        self.addCleanup(self._patch.stop)

    def _set_response(self, payload, status: int = 200):
        self.opener.open.return_value = _fake_body(payload, status)

    def test_empty_query_returns_empty(self):
        # No network call should happen at all.
        out = self.sp.search("")
        self.assertEqual(out, [])
        self.opener.open.assert_not_called()

    def test_refuses_non_list_payload(self):
        self._set_response({"oops": "object instead of list"})
        with self.assertRaises(SearchError):
            self.sp.search("anything")

    def test_refuses_non_utf8(self):
        # Latin-1 ÿ (0xff) — invalid UTF-8 start byte.
        self.opener.open.return_value = _fake_body(b"\xff\xfe", status=200)
        with self.assertRaises(SearchError) as ctx:
            self.sp.search("x")
        self.assertIn("non-utf-8", str(ctx.exception))

    def test_refuses_malformed_json(self):
        self.opener.open.return_value = _fake_body(b"not json")
        with self.assertRaises(SearchError):
            self.sp.search("x")

    def test_refuses_oversize_response(self):
        big = b"[" + b"0," * (SearchProxy.MAX_RESPONSE_BYTES) + b"0]"
        self.opener.open.return_value = _fake_body(big)
        with self.assertRaises(SearchError) as ctx:
            self.sp.search("x")
        self.assertIn("size cap", str(ctx.exception))

    def test_caps_results(self):
        items = [{"content_id": GOOD_CID, "name": f"ch{i}"}
                 for i in range(SearchProxy.MAX_RESULTS + 20)]
        self._set_response(items)
        out = self.sp.search("anything")
        self.assertEqual(len(out), SearchProxy.MAX_RESULTS)

    def test_returns_sanitised_names(self):
        # Upstream can dump bidi overrides into names; we strip them.
        items = [{"content_id": GOOD_CID,
                  "name": "Sky‮EVIL",
                  "translated_name": "Sky"}]
        self._set_response(items)
        out = self.sp.search("q")
        self.assertEqual(len(out), 1)
        self.assertNotIn("‮", out[0]["name"])

    def test_raises_on_http_error(self):
        self.opener.open.side_effect = urllib.error.HTTPError(
            "http://x", 500, "boom", {}, None)
        with self.assertRaises(SearchError) as ctx:
            self.sp.search("x")
        self.assertIn("500", str(ctx.exception))

    def test_raises_on_timeout(self):
        self.opener.open.side_effect = socket.timeout()
        with self.assertRaises(SearchError) as ctx:
            self.sp.search("x")
        self.assertIn("timed out", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
