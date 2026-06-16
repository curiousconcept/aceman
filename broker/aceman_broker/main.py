"""Broker entry point.

Validates configuration, acquires the singleton, signs up SIGTERM /
SIGINT for clean shutdown, and serves the accept loop until told
to stop. Each connection runs on its own daemon thread.
"""

from __future__ import annotations

import os
import signal
import socket
import sys
import threading

from .config import ENGINE_URL, IMAGE, NAME, validate_at_startup
from .dispatcher import handle
from .logging_util import _log
from .paths import sock_path
from .singleton import acquire_singleton


def main() -> int:
    validate_at_startup()

    acquired = acquire_singleton()
    if acquired is None:
        # Another broker is already serving (or a startup is in
        # flight). Exit cleanly so we don't take the second broker
        # down by signalling SIGTERM.
        return 0
    srv, our_dev_ino = acquired

    sp = sock_path()
    _log("main", "listening at %s (image=%s container=%s engine=%s)",
         sp, IMAGE, NAME, ENGINE_URL)

    stopping = threading.Event()

    def _shutdown(_signo, _frame):
        if stopping.is_set():
            return
        stopping.set()
        _log("main", "shutting down")
        try:
            srv.close()
        except OSError:
            pass
        # Only unlink the path if it still points at OUR inode.
        # Otherwise we'd be removing some other broker's socket file
        # while leaving them holding the kernel socket — making them
        # unreachable without their knowledge.
        try:
            current = os.stat(sp)
            if our_dev_ino is None or (
                    current.st_dev, current.st_ino) == our_dev_ino:
                sp.unlink()
            else:
                _log("main",
                     "leaving %s alone — different inode (rebound)", sp)
        except FileNotFoundError:
            pass
        except OSError as e:
            _log("main", "cleanup stat failed: %s", e)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    while not stopping.is_set():
        try:
            conn, _peer = srv.accept()
        except OSError:
            break
        threading.Thread(target=handle, args=(conn,), daemon=True).start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
