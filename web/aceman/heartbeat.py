"""Heartbeat tracker for the idle-shutdown watcher.

Tiny SRP-pure module: every frontend ping into the server bumps the
last-seen timestamp; the watcher polls ``idle_for`` to decide whether
the browser has gone away and the server should shut itself down.
"""

from __future__ import annotations

import threading
import time


class HeartbeatTracker:
    """Tracks the last time any frontend pinged /api/heartbeat.

    Returns ``None`` for "no heartbeat ever received" so the watcher
    can distinguish a fresh server (no browser yet — keep alive) from
    one whose tab has just been closed (heartbeats stopped — shut
    down).
    """

    def __init__(self) -> None:
        self._last_seen: "float | None" = None
        self._lock = threading.Lock()

    def ping(self) -> None:
        with self._lock:
            self._last_seen = time.monotonic()

    def idle_for(self) -> "float | None":
        with self._lock:
            if self._last_seen is None:
                return None
            return time.monotonic() - self._last_seen
