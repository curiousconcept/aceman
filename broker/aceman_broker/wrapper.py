"""Inspect the shell wrapper's PID file.

The aceman shell wrapper writes its ``$$`` into
``$XDG_RUNTIME_DIR/aceman.active.pid`` while a player is up. The
broker uses that to (a) report "wrapper_alive" in engine.status, and
(b) SIGTERM the live wrapper in ``player.stop``.

The PID-reuse guard is the security-critical bit: a stale PID file
that points at a recycled, unrelated process must NOT count as
"player alive" — otherwise we'd refuse to start a new stream because
some random other process happens to have the same PID.
"""

from __future__ import annotations

import pathlib

from .paths import wrapper_pid_file


def read_wrapper_pid() -> "int | None":
    """Return the wrapper PID if the file exists and parses, else None.
    Doesn't check liveness."""
    pid_file = wrapper_pid_file()
    if not pid_file.is_file():
        return None
    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        return None
    if pid <= 1:
        return None
    return pid


def pid_matches_aceman(pid: int) -> bool:
    """Confirm ``/proc/<pid>/cmdline`` actually contains 'aceman' so
    we don't signal an unrelated process that reused this PID. This
    is the critical PID-reuse guard."""
    try:
        cmdline = pathlib.Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return False
    return b"aceman" in cmdline


def wrapper_alive() -> bool:
    """True iff the wrapper PID file references a still-living
    process whose cmdline mentions 'aceman'."""
    pid = read_wrapper_pid()
    if pid is None:
        return False
    return pid_matches_aceman(pid)
