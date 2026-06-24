"""Tests for HistoryStore."""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import tempfile
import unittest

from aceman.history import HistoryStore

CID_A = "a" * 40
CID_B = "b" * 40
CID_C = "c" * 40


class HistoryStoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = HistoryStore(pathlib.Path(self._tmp.name) / "db.sqlite")

    # ------------------------------------------------------------------ record

    def test_record_and_list(self):
        self.store.record(CID_A, "Channel A")
        rows = self.store.list()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cid"], CID_A)
        self.assertEqual(rows[0]["name"], "Channel A")

    def test_record_blank_name_ignored(self):
        self.store.record(CID_A, "")
        self.assertEqual(self.store.list(), [])

    def test_record_invalid_cid_ignored(self):
        self.store.record("not-a-cid", "Name")
        self.assertEqual(self.store.list(), [])

    def test_record_upserts_on_same_cid(self):
        self.store.record(CID_A, "Old Name")
        self.store.record(CID_A, "New Name")
        rows = self.store.list()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "New Name")

    def test_record_cid_lowercased(self):
        self.store.record(CID_A.upper(), "Channel A")
        rows = self.store.list()
        self.assertEqual(rows[0]["cid"], CID_A.lower())

    # -------------------------------------------------------------------- list

    def test_list_ordered_most_recent_first(self):
        # Insert with explicit timestamps to avoid same-second collision.
        import sqlite3
        with sqlite3.connect(self.store.db_path) as c:
            c.execute("INSERT INTO watch_history(cid,name,played_at) VALUES (?,?,?)",
                      (CID_A, "A", "2024-01-01 10:00:00"))
            c.execute("INSERT INTO watch_history(cid,name,played_at) VALUES (?,?,?)",
                      (CID_B, "B", "2024-01-01 11:00:00"))
        rows = self.store.list()
        self.assertEqual(rows[0]["cid"], CID_B)
        self.assertEqual(rows[1]["cid"], CID_A)

    def test_list_limit(self):
        self.store.record(CID_A, "A")
        self.store.record(CID_B, "B")
        self.store.record(CID_C, "C")
        rows = self.store.list(limit=2)
        self.assertEqual(len(rows), 2)

    def test_list_empty(self):
        self.assertEqual(self.store.list(), [])

    def test_list_row_has_played_at(self):
        self.store.record(CID_A, "A")
        row = self.store.list()[0]
        self.assertIn("played_at", row)
        self.assertIsNotNone(row["played_at"])

    # ------------------------------------------------------------------ delete

    def test_delete_existing(self):
        self.store.record(CID_A, "A")
        self.assertTrue(self.store.delete(CID_A))
        self.assertEqual(self.store.list(), [])

    def test_delete_missing_returns_false(self):
        self.assertFalse(self.store.delete(CID_A))

    def test_delete_invalid_cid_returns_false(self):
        self.assertFalse(self.store.delete("bad"))

    def test_delete_only_removes_target(self):
        self.store.record(CID_A, "A")
        self.store.record(CID_B, "B")
        self.store.delete(CID_A)
        rows = self.store.list()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cid"], CID_B)

    # ------------------------------------------------------------------- clear

    def test_clear_removes_all(self):
        self.store.record(CID_A, "A")
        self.store.record(CID_B, "B")
        self.store.clear()
        self.assertEqual(self.store.list(), [])

    def test_clear_on_empty_is_safe(self):
        self.store.clear()  # must not raise
        self.assertEqual(self.store.list(), [])

    # --------------------------------------------------------- shares db file

    def test_shares_db_with_fav_store(self):
        """HistoryStore must coexist in the same SQLite file as FavStore."""
        from aceman.favourites import FavStore
        db = pathlib.Path(self._tmp.name) / "db.sqlite"
        fav = FavStore(db)
        hist = HistoryStore(db)
        fav.add("My Channel", CID_A)
        hist.record(CID_B, "Another")
        self.assertEqual(len(fav.list()), 1)
        self.assertEqual(len(hist.list()), 1)
