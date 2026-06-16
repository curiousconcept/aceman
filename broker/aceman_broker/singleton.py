"""Singleton enforcement for the broker socket.

Two layers, both required:

  1. **Cross-process flock** on ``broker.lock``. Held for the lifetime
     of the broker. If two near-simultaneous spawns race the
     "probe + unlink + bind" sequence below, the flock keeps the
     check-then-act atomic.

  2. **Socket probe** of the existing path. If something already
     accepts a connection on the socket, exit cleanly — another
     broker is alive and we should not stomp it.

The function returns ``(srv_socket, our_dev_ino)`` on success or
``None`` if another broker is already serving (the caller should exit
clean).
"""

from __future__ import annotations

import fcntl
import os
import socket

from .logging_util import _log
from .paths import sock_dir, sock_path


def acquire_singleton() -> "tuple[socket.socket, tuple[int, int] | None] | None":
    sd = sock_dir()
    sd.mkdir(parents=True, exist_ok=True)

    lock_path = sd / "broker.lock"
    lock_fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        _log("main",
             "another broker startup is in flight (lock held) — exiting")
        os.close(lock_fd)
        return None

    sp = sock_path()
    if sp.exists():
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        probe.settimeout(0.5)
        try:
            probe.connect(str(sp))
            probe.close()
            _log("main",
                 "another broker is already serving at %s — exiting", sp)
            return None
        except (ConnectionRefusedError, FileNotFoundError, OSError):
            try:
                probe.close()
            except OSError:
                pass
            try:
                sp.unlink()
            except FileNotFoundError:
                pass

    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(str(sp))
    # Belt-and-braces: the kernel enforces $XDG_RUNTIME_DIR perms
    # (0700) already, but pin the socket too so a leaky perms change
    # above doesn't widen access.
    os.chmod(sp, 0o600)
    srv.listen(8)

    # Stash the dev+inode our bind created so the shutdown handler
    # only unlinks the path if it still points at OUR inode (some other
    # broker might have rebound in the meantime).
    try:
        st = os.stat(sp)
        our_dev_ino = (st.st_dev, st.st_ino)
    except OSError:
        our_dev_ino = None
    return srv, our_dev_ino
