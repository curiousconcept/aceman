"""Tests for the multi-source result merge (dedup by cid, order, cap)."""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

from server.search_merge import merge_results

A = "a" * 40
B = "b" * 40
C = "c" * 40


def _r(cid, name="n"):
    return {"cid": cid, "name": name, "translated_name": ""}


class MergeTests(unittest.TestCase):
    def test_concatenates_distinct(self):
        out = merge_results([[_r(A)], [_r(B), _r(C)]])
        self.assertEqual([r["cid"] for r in out], [A, B, C])

    def test_dedupes_by_cid_first_source_wins(self):
        out = merge_results([[_r(A, "from-proxy")], [_r(A, "from-engine")]])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["name"], "from-proxy")

    def test_preserves_within_and_across_source_order(self):
        out = merge_results([[_r(B), _r(A)], [_r(C), _r(A)]])
        self.assertEqual([r["cid"] for r in out], [B, A, C])

    def test_skips_empty_or_missing_cid(self):
        out = merge_results([[{"name": "x"}, _r(""), _r(A)]])
        self.assertEqual([r["cid"] for r in out], [A])

    def test_caps_at_max_results(self):
        many = [_r(f"{i:040x}") for i in range(80)]
        self.assertEqual(len(merge_results([many], max_results=50)), 50)

    def test_empty_input(self):
        self.assertEqual(merge_results([]), [])
        self.assertEqual(merge_results([[], []]), [])


if __name__ == "__main__":
    unittest.main()
