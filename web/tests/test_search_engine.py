"""Tests for the engine-local search source.

The engine is treated as adversarial, so the focus is normalisation +
hardening: nested shape → flat {cid, name, translated_name}, bad items
dropped, malformed / oversize / unreachable responses raise SearchError.
No real network — urlopen is mocked.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import json
import unittest
import unittest.mock as mock

from server.search import SearchError
from server.search_engine import (
    MAX_SEARCH_BYTES, _clean_item, engine_search,
)

A = "a" * 40
B = "b" * 40


class _FakeResp:
    def __init__(self, body):
        self._b = body if isinstance(body, bytes) else body.encode("utf-8")

    def read(self, n=-1):
        return self._b[:n] if n is not None and n >= 0 else self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _with_body(obj):
    body = obj if isinstance(obj, (bytes, str)) else json.dumps(obj)
    return mock.patch("server.search_engine.urllib.request.urlopen",
                      return_value=_FakeResp(body))


SAMPLE = {"result": {"total": 3, "results": [
    {"name": "G1", "items": [{"infohash": A.upper(), "name": "Chan A"}]},
    {"name": "G2", "items": [
        {"infohash": B, "name": "Chan B"},
        {"infohash": "not-hex", "name": "dropped"},
        {"infohash": "c" * 40, "name": "   "},      # blank name → dropped
    ]},
]}}


class CleanItemTests(unittest.TestCase):
    def test_normalises_and_lowercases(self):
        self.assertEqual(
            _clean_item({"infohash": A.upper(), "name": "X"}),
            {"cid": A, "name": "X", "translated_name": ""})

    def test_drops_bad_infohash(self):
        self.assertIsNone(_clean_item({"infohash": "xyz", "name": "X"}))
        self.assertIsNone(_clean_item({"infohash": 123, "name": "X"}))

    def test_drops_non_dict_and_blank_name(self):
        self.assertIsNone(_clean_item("nope"))
        self.assertIsNone(_clean_item({"infohash": A, "name": "   "}))


class EngineSearchTests(unittest.TestCase):
    def test_flattens_groups_and_drops_bad_items(self):
        with _with_body(SAMPLE):
            out = engine_search("http://127.0.0.1:6878", "sport")
        self.assertEqual(out, [
            {"cid": A, "name": "Chan A", "translated_name": ""},
            {"cid": B, "name": "Chan B", "translated_name": ""},
        ])

    def test_empty_query_skips_network(self):
        # No urlopen patch → if it tried the network the test would error.
        self.assertEqual(engine_search("http://e", "   "), [])

    def test_results_not_a_list_yields_empty(self):
        with _with_body({"result": {"results": "nope"}}):
            self.assertEqual(engine_search("http://e", "q"), [])

    def test_missing_result_raises(self):
        with _with_body({"error": "boom"}):
            with self.assertRaises(SearchError):
                engine_search("http://e", "q")

    def test_malformed_json_raises(self):
        with _with_body(b"{not json"):
            with self.assertRaises(SearchError):
                engine_search("http://e", "q")

    def test_oversize_raises(self):
        big = b'{"result": {"results": []}}' + b" " * (MAX_SEARCH_BYTES + 10)
        with _with_body(big):
            with self.assertRaises(SearchError):
                engine_search("http://e", "q")

    def test_unreachable_raises(self):
        import urllib.error
        with mock.patch("server.search_engine.urllib.request.urlopen",
                        side_effect=urllib.error.URLError("refused")):
            with self.assertRaises(SearchError):
                engine_search("http://e", "q")

    def test_caps_result_count(self):
        items = [{"infohash": f"{i:040x}", "name": f"c{i}"} for i in range(120)]
        payload = {"result": {"results": [{"name": "G", "items": items}]}}
        with _with_body(payload):
            out = engine_search("http://e", "q")
        self.assertEqual(len(out), 50)


if __name__ == "__main__":
    unittest.main()
