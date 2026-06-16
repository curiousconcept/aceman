"""XDG path resolution for runtime / config / data dirs.

Pure functions — no I/O at import. The broker reads these once at
startup and caches the results into the running state.
"""

from __future__ import annotations

import os
import pathlib


def xdg_runtime_dir() -> pathlib.Path:
    """``$XDG_RUNTIME_DIR`` or the standard fallback under
    ``/run/user/<uid>``. Used to locate the broker socket and the
    wrapper PID file."""
    return pathlib.Path(
        os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    )


def sock_dir() -> pathlib.Path:
    return xdg_runtime_dir() / "aceman"


def sock_path() -> pathlib.Path:
    return sock_dir() / "broker.sock"


def wrapper_pid_file() -> pathlib.Path:
    """The shell wrapper writes its $$ here while a player is up.
    Reading it tells us whether VLC/mpv is still live."""
    return xdg_runtime_dir() / "aceman.active.pid"


def desktop_applications_dir() -> pathlib.Path:
    base = pathlib.Path(
        os.environ.get("XDG_DATA_HOME")
        or pathlib.Path.home() / ".local" / "share"
    )
    return base / "applications"


def mimeapps_list_path() -> pathlib.Path:
    base = pathlib.Path(
        os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config"
    )
    return base / "mimeapps.list"
