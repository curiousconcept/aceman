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

from .paths import wrapper_cid_file, wrapper_pid_file


# 40-hex content id. Validated before exposing to the web so a stray
# byte in the runtime file can't reach the frontend unchecked.
import re as _re
_HEX40 = _re.compile(r"^[A-Fa-f0-9]{40}$")


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


def wrapper_cid() -> str:
    """The cid the wrapper reports it's playing right now, lowercased.
    Empty string when no wrapper is up or the file is unreadable /
    not 40 hex chars. Validated so the web frontend can trust the
    returned bytes without re-checking."""
    p = wrapper_cid_file()
    try:
        raw = p.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return ""
    return raw.lower() if _HEX40.match(raw) else ""


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
