"""Watch-history store.

Shares the same SQLite file as :class:`FavStore` so a single
db_path covers all server-side state. One row per cid (upsert on
play); entries without a name are never written — raw-cid plays
are excluded by the caller. Capped at 500 rows so the table never
grows unboundedly.
"""

from __future__ import annotations

import pathlib
import sqlite3
import threading

from .constants import HEX40

_MAX_ROWS = 500


class HistoryStore:
    def __init__(self, db_path: pathlib.Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS watch_history ("
                "  cid       TEXT PRIMARY KEY,"
                "  name      TEXT NOT NULL,"
                "  played_at TEXT NOT NULL"
                ")"
            )

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path, timeout=5)

    def record(self, cid: str, name: str) -> None:
        if not name or not HEX40.match(cid):
            return
        with self._lock, self._conn() as c:
            c.execute(
                "INSERT INTO watch_history(cid, name, played_at) "
                "VALUES (?, ?, datetime('now')) "
                "ON CONFLICT(cid) DO UPDATE SET "
                "  name=excluded.name, played_at=excluded.played_at",
                (cid.lower(), name),
            )
            # Trim to cap; keep the most-recent rows.
            c.execute(
                "DELETE FROM watch_history WHERE cid NOT IN ("
                "  SELECT cid FROM watch_history "
                "  ORDER BY played_at DESC LIMIT ?)",
                (_MAX_ROWS,),
            )

    def list(self, limit: int | None = None) -> list[dict]:
        q = ("SELECT cid, name, played_at FROM watch_history "
             "ORDER BY played_at DESC")
        if limit is not None:
            q += f" LIMIT {int(limit)}"
        with self._lock, self._conn() as c:
            rows = c.execute(q).fetchall()
        return [{"cid": cid, "name": name, "played_at": pa}
                for cid, name, pa in rows]

    def delete(self, cid: str) -> bool:
        if not HEX40.match(cid):
            return False
        with self._lock, self._conn() as c:
            cur = c.execute(
                "DELETE FROM watch_history WHERE cid = ?", (cid.lower(),))
        return cur.rowcount > 0

    def clear(self) -> None:
        with self._lock, self._conn() as c:
            c.execute("DELETE FROM watch_history")
