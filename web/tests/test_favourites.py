"""Security tests for the favourites store.

The name policy is the first defence against display spoofing in the
favourites list (the same content id under two indistinguishable
names) and against breaking the column-separated flat-file backing
the shell wrapper. The cid policy is the first defence against
arbitrary strings reaching the engine.

All tests run against a temp-dir-backed sqlite db — no fixtures, no
mocks.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import sqlite3
import tempfile
import unittest

from aceman.favourites import Config, DuplicateCidError, FavStore


CID_A = "a" * 40
CID_B = "b" * 40


class FavStoreNameValidationTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = FavStore(pathlib.Path(self._tmp.name) / "db.sqlite")

    def test_rejects_empty_name(self):
        with self.assertRaises(ValueError):
            self.store.add("", CID_A)

    def test_rejects_over_128_chars(self):
        with self.assertRaises(ValueError):
            self.store.add("x" * 129, CID_A)

    def test_rejects_tab(self):
        with self.assertRaises(ValueError):
            self.store.add("Sky\tSports", CID_A)

    def test_rejects_control_byte(self):
        with self.assertRaises(ValueError):
            self.store.add("Sky\x07Sports", CID_A)

    def test_rejects_zero_width_space(self):
        # Spoofing aid — looks like "Sky Sports" but is a distinct
        # identifier.
        with self.assertRaises(ValueError):
            self.store.add("Sky​Sports", CID_A)

    def test_rejects_bidi_override(self):
        with self.assertRaises(ValueError):
            self.store.add("Sky‮EVIL", CID_A)

    def test_rejects_bom(self):
        with self.assertRaises(ValueError):
            self.store.add("﻿Sky Sports", CID_A)

    def test_accepts_cyrillic(self):
        # The bug we fixed: "Матч ТВ" was rejected because the original
        # forbidden-set regex had stray invisible bidi codepoints in
        # the source.
        self.store.add("Матч ТВ", CID_A)
        rows = self.store.list()
        self.assertEqual(rows[0]["name"], "Матч ТВ")

    def test_accepts_cjk(self):
        self.store.add("体育频道", CID_A)
        self.assertEqual(self.store.list()[0]["name"], "体育频道")

    def test_accepts_emoji(self):
        # Emoji aren't bidi/spoofing chars; they're regular glyphs.
        self.store.add("⚽ Sports", CID_A)
        self.assertEqual(self.store.list()[0]["name"], "⚽ Sports")


class FavStoreCidValidationTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = FavStore(pathlib.Path(self._tmp.name) / "db.sqlite")

    def test_rejects_too_short(self):
        with self.assertRaises(ValueError):
            self.store.add("ok", "a" * 39)

    def test_rejects_too_long(self):
        with self.assertRaises(ValueError):
            self.store.add("ok", "a" * 41)

    def test_rejects_non_hex(self):
        with self.assertRaises(ValueError):
            self.store.add("ok", "z" * 40)

    def test_rejects_sql_injection_in_cid(self):
        # cid would be parameter-bound either way, but the NAME_OK
        # match happens first — confirms we reject before the SQL
        # layer ever sees it.
        with self.assertRaises(ValueError):
            self.store.add("ok", "' OR 1=1 --")

    def test_lowercases_on_storage(self):
        self.store.add("Channel", "A" * 40)
        self.assertEqual(self.store.list()[0]["cid"], "a" * 40)


class FavStoreUniquenessTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = FavStore(pathlib.Path(self._tmp.name) / "db.sqlite")
        self.store.add("Sky Sports", CID_A)

    def test_duplicate_cid_different_name_raises(self):
        with self.assertRaises(DuplicateCidError) as ctx:
            self.store.add("Sky Sports HD", CID_A)
        self.assertEqual(ctx.exception.existing_name, "Sky Sports")

    def test_same_name_same_cid_is_noop(self):
        # Re-saving with the exact same name + cid should not raise.
        self.store.add("Sky Sports", CID_A)
        self.assertEqual(len(self.store.list()), 1)

    def test_rename_to_existing_name_raises(self):
        self.store.add("Sports HD", CID_B)
        with self.assertRaises(ValueError):
            self.store.rename("Sports HD", "Sky Sports")

    def test_rename_validates_new_name(self):
        with self.assertRaises(ValueError):
            self.store.rename("Sky Sports", "Sky\tSports")

    def test_rename_missing_raises_keyerror(self):
        with self.assertRaises(KeyError):
            self.store.rename("Nope", "Whatever")


class FavStoreLifecycleTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = pathlib.Path(self._tmp.name) / "db.sqlite"
        self.store = FavStore(self.path)

    def test_find_by_cid_roundtrip(self):
        self.store.add("Channel", CID_A)
        self.assertEqual(self.store.find_by_cid(CID_A), "Channel")
        self.assertIsNone(self.store.find_by_cid(CID_B))

    def test_find_by_cid_rejects_bad_cid(self):
        # Bad cid returns None silently — caller doesn't care.
        self.assertIsNone(self.store.find_by_cid("z" * 40))
        self.assertIsNone(self.store.find_by_cid("short"))

    def test_delete_returns_true_on_hit(self):
        self.store.add("Channel", CID_A)
        self.assertTrue(self.store.delete("Channel"))
        self.assertFalse(self.store.delete("Channel"))

    def test_touch_only_updates_known_cid(self):
        self.store.add("Channel", CID_A)
        self.store.touch_by_cid(CID_A)
        self.assertIsNotNone(self.store.list()[0]["last_played"])

    def test_touch_with_bad_cid_is_noop(self):
        self.store.touch_by_cid("not40hex")  # must not raise

    def test_schema_has_length_check_on_cid(self):
        # Schema-level guarantee: even direct sqlite writes can't smuggle
        # a wrong-length cid past the constraint. This protects against
        # a future code path that bypasses .add() (e.g. a migration
        # script).
        with sqlite3.connect(self.path) as c:
            with self.assertRaises(sqlite3.IntegrityError):
                c.execute(
                    "INSERT INTO favorites(name, cid) VALUES (?, ?)",
                    ("bad", "tooShort"))


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = pathlib.Path(self._tmp.name) / "config.json"
        self.cfg = Config(self.path)

    def test_defaults(self):
        snap = self.cfg.snapshot()
        self.assertTrue(snap["engine_autostart"])
        self.assertEqual(snap["playback_mode"], "external")

    def test_rejects_unknown_key(self):
        with self.assertRaises(ValueError):
            self.cfg.update({"do_evil": True})

    def test_rejects_wrong_type(self):
        with self.assertRaises(ValueError):
            self.cfg.update({"engine_autostart": "yes"})  # str not bool
        with self.assertRaises(ValueError):
            self.cfg.update({"default_player": 1234})    # int not str

    def test_persists_to_disk_atomically(self):
        self.cfg.update({"default_player": "vlc"})
        # New Config from same path reads back the persisted state.
        cfg2 = Config(self.path)
        self.assertEqual(cfg2.get("default_player"), "vlc")

    def test_ignores_unknown_keys_on_load(self):
        # Forward-compatible: a config written by a future build with
        # extra keys loads cleanly under an older build.
        self.path.write_text(
            '{"default_player": "vlc", "future_field": 42}')
        cfg = Config(self.path)
        self.assertEqual(cfg.get("default_player"), "vlc")

    def test_ignores_wrong_type_on_load(self):
        self.path.write_text('{"engine_autostart": "not_a_bool"}')
        cfg = Config(self.path)
        # Falls back to default (True).
        self.assertTrue(cfg.get("engine_autostart"))

    def test_recovers_from_corrupt_file(self):
        self.path.write_text("{ this is not json")
        cfg = Config(self.path)
        # Defaults intact.
        self.assertTrue(cfg.get("engine_autostart"))


if __name__ == "__main__":
    unittest.main()
