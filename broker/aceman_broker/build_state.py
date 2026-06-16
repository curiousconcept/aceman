"""Shared build state for the image-install background thread.

The broker's ``image.install`` action kicks off ``podman build`` in
a daemon thread and returns immediately; the UI polls ``image.status``
to see progress. All three need to read/write the same handful of
fields, which is what this module isolates.

Every mutation goes through the lock so a poll mid-build can't
observe a half-updated state.
"""

from __future__ import annotations

import threading
from collections import deque

from .config import BUILD_LOG_CAP


class BuildState:
    """One running build at a time. Thread-safe."""

    def __init__(self, cap: int = BUILD_LOG_CAP) -> None:
        self._lock = threading.Lock()
        self._log: "deque[str]" = deque(maxlen=cap)
        self._state = "unknown"   # unknown | absent | installed | building | failed
        self._error: "str | None" = None
        self._thread: "threading.Thread | None" = None

    # ---- state machine -----------------------------------------------

    def state(self) -> str:
        with self._lock:
            return self._state

    def error(self) -> "str | None":
        with self._lock:
            return self._error

    def transition(self, state: str, *, error: "str | None" = None) -> None:
        with self._lock:
            self._state = state
            self._error = error

    # ---- log tail ----------------------------------------------------

    def append_line(self, line: str) -> None:
        with self._lock:
            self._log.append(line)

    def tail(self) -> "list[str]":
        with self._lock:
            return list(self._log)

    def clear_log(self) -> None:
        with self._lock:
            self._log.clear()

    # ---- thread bookkeeping ------------------------------------------

    def attach_thread(self, t: threading.Thread) -> None:
        with self._lock:
            self._thread = t

    def is_busy(self) -> bool:
        with self._lock:
            t = self._thread
        return t is not None and t.is_alive()


# Module-level singleton: there's only ever one image build per
# broker instance. Other modules reach for this rather than carry
# the object through their argv.
build_state = BuildState()
