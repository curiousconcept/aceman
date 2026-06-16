"""Favourites store + server-side per-user config.

Two thin classes:

  * :class:`Config` — JSON-file key/value store for the handful of
    preferences the UI saves between sessions
    (engine_autostart, default_player, …).
  * :class:`FavStore` — sqlite-backed favourite-channels list, keyed by
    name with a content-id index. NAME_OK enforces the same character
    policy as the shell wrapper's flat file so the two stay
    interchangeable.

Sqlite is imported conditionally; if it's unavailable :class:`FavStore`
isn't instantiable and the frontend falls back to localStorage. The
import gate lives in ``aceman_web.py`` to keep this module
import-cost-free.
"""

from __future__ import annotations

import json
import pathlib
import sqlite3
import threading

from .constants import HEX40, NAME_OK


class DuplicateCidError(Exception):
    """Raised when adding a favourite collides with an existing entry
    that has the same content id under a different name. Carries the
    existing name so the caller can tell the user what to look for."""

    def __init__(self, existing_name: str):
        super().__init__(f"already saved as '{existing_name}'")
        self.existing_name = existing_name


class Config:
    """Tiny JSON-file key/value store for server-side preferences.

    Lives alongside the favourites DB so wiping ``~/.config/aceman``
    resets everything together. Writes are atomic via tmp+rename so a
    crash mid-save can't leave a half-written file.

    Only known keys with matching types are accepted; unknown keys
    raise ``ValueError`` rather than silently expanding the schema.
    """

    _ALLOWED = {
        "engine_autostart": bool,
        "default_player": str,
        "default_player_source": str,
        "playback_mode": str,
        "default_browser": str,
        "default_browser_source": str,
    }

    def __init__(self, path: pathlib.Path):
        self.path = path
        self._lock = threading.Lock()
        self._data: dict = {
            "engine_autostart": True,
            "default_player": "",
            "default_player_source": "",
            "playback_mode": "external",
            "default_browser": "",
            "default_browser_source": "",
        }
        if path.is_file():
            try:
                loaded = json.loads(path.read_text())
                if isinstance(loaded, dict):
                    for k, v in loaded.items():
                        if k in self._ALLOWED and isinstance(v, self._ALLOWED[k]):
                            self._data[k] = v
            except (OSError, json.JSONDecodeError):
                pass  # corrupt file → start from defaults

    def get(self, key: str, default=None):
        with self._lock:
            return self._data.get(key, default)

    def update(self, patch: dict) -> dict:
        """Apply only known keys with matching types. Returns the new
        state."""
        with self._lock:
            for k, v in patch.items():
                if k not in self._ALLOWED:
                    raise ValueError(f"unknown config key: {k}")
                if not isinstance(v, self._ALLOWED[k]):
                    raise ValueError(
                        f"config key {k} must be {self._ALLOWED[k].__name__}")
                self._data[k] = v
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(self._data, indent=2))
            tmp.replace(self.path)
            return dict(self._data)

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._data)


class FavStore:
    """Thread-safe SQLite-backed favourites store.

    Schema is conservative: name PRIMARY KEY, cid CHECK(length=40),
    last_played stamp. Duplicate cids under a different name raise
    :class:`DuplicateCidError`; re-saving under the same name is a
    no-op so callers don't have to special-case it.
    """

    def __init__(self, db_path: pathlib.Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS favorites ("
                "  name TEXT PRIMARY KEY,"
                "  cid  TEXT NOT NULL CHECK(length(cid)=40),"
                "  last_played TEXT"
                ")"
            )
            # In-place migration for dbs created before the last_played
            # column existed. ALTER TABLE ADD COLUMN is non-destructive.
            cols = {r[1] for r in c.execute("PRAGMA table_info(favorites)")}
            if "last_played" not in cols:
                c.execute(
                    "ALTER TABLE favorites ADD COLUMN last_played TEXT")
            c.execute(
                "CREATE INDEX IF NOT EXISTS favorites_cid_idx ON favorites(cid)")

    def _conn(self) -> "sqlite3.Connection":
        # Re-open per call so the store works correctly across handler
        # threads (sqlite3.Connection isn't safe for cross-thread use).
        return sqlite3.connect(self.db_path, timeout=5)

    def list(self) -> "list[dict]":
        with self._lock, self._conn() as c:
            rows = c.execute(
                "SELECT name, cid, last_played FROM favorites "
                "ORDER BY name COLLATE NOCASE"
            ).fetchall()
        return [
            {"name": n, "cid": cid, "last_played": lp}
            for n, cid, lp in rows
        ]

    def add(self, name: str, cid: str) -> None:
        if not NAME_OK.match(name):
            raise ValueError(
                "invalid name (1-128 chars; letters from any script "
                "are fine — no tabs, no control bytes, no "
                "invisible/bidi characters)")
        if not HEX40.match(cid):
            raise ValueError("invalid content id")
        cid_l = cid.lower()
        with self._lock, self._conn() as c:
            existing = c.execute(
                "SELECT name FROM favorites WHERE cid = ?", (cid_l,)
            ).fetchone()
            if existing and existing[0] != name:
                raise DuplicateCidError(existing[0])
            c.execute(
                "INSERT OR REPLACE INTO favorites(name, cid) VALUES (?, ?)",
                (name, cid_l),
            )

    def find_by_cid(self, cid: str) -> "str | None":
        if not HEX40.match(cid):
            return None
        with self._lock, self._conn() as c:
            row = c.execute(
                "SELECT name FROM favorites WHERE cid = ?", (cid.lower(),)
            ).fetchone()
        return row[0] if row else None

    def rename(self, old: str, new: str) -> None:
        if not NAME_OK.match(new):
            raise ValueError(
                "invalid name (1-128 chars; letters from any script "
                "are fine — no tabs, no control bytes, no "
                "invisible/bidi characters)")
        with self._lock, self._conn() as c:
            existing = c.execute(
                "SELECT 1 FROM favorites WHERE name = ?", (new,)
            ).fetchone()
            if existing and old != new:
                raise ValueError(f"name '{new}' is already in use")
            cur = c.execute(
                "UPDATE favorites SET name = ? WHERE name = ?", (new, old)
            )
            if cur.rowcount == 0:
                raise KeyError(old)

    def touch_by_cid(self, cid: str) -> None:
        """Stamp last_played=NOW for any row matching this cid. Quiet
        no-op if the cid isn't a favourite — the caller doesn't need
        to care."""
        if not HEX40.match(cid):
            return
        with self._lock, self._conn() as c:
            c.execute(
                "UPDATE favorites SET last_played = datetime('now') "
                "WHERE cid = ?",
                (cid.lower(),),
            )

    def delete(self, name: str) -> bool:
        with self._lock, self._conn() as c:
            cur = c.execute(
                "DELETE FROM favorites WHERE name = ?", (name,))
        return cur.rowcount > 0
