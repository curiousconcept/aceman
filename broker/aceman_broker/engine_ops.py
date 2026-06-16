"""Read-only queries against podman + the engine HTTP API.

Each function returns a soft signal (bool/str), never raises. The
state machine of "is the engine up?" is built on top of these in
``actions/engine.py``.
"""

from __future__ import annotations

import subprocess
import urllib.error
import urllib.request

from .config import NAME, PROBE_TIMEOUT, ENGINE_URL, IMAGE


def engine_probe(timeout: float = PROBE_TIMEOUT) -> bool:
    """True iff the engine HTTP API answers a get_version call."""
    url = ENGINE_URL + "/webui/api/service?method=get_version"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def container_running_named(name: str) -> bool:
    """True iff a podman container with this EXACT name is in
    ``podman ps``."""
    try:
        r = subprocess.run(
            ["podman", "ps", "--filter", f"name=^{name}$",
             "--format", "{{.Names}}"],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0 and name in r.stdout.split()


def container_running() -> bool:
    return container_running_named(NAME)


def container_state() -> str:
    """Detailed engine container lifecycle state.

    Returns one of: ``running``, ``exited``, ``created``, ``missing``,
    ``unknown``. The UI uses this to distinguish "still starting up,
    give it time" from "truly dead, stop waiting" during the
    restart-settling window."""
    try:
        r = subprocess.run(
            ["podman", "ps", "-a", "--filter", f"name=^{NAME}$",
             "--format", "{{.State}}"],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "unknown"
    if r.returncode != 0:
        return "unknown"
    lines = (r.stdout or "").strip().splitlines()
    if not lines:
        return "missing"
    s = lines[0].strip().lower()
    if s in ("running", "exited", "created"):
        return s
    # podman maps 'paused', 'stopped', 'stopping', etc → fold to one
    # of our four. 'stopping' is the mid-podman-stop transient that
    # drove the UI's settling into 'unknown'-forever; classify it as
    # exited so the settling window clears immediately after stop
    # completes.
    if s in ("stopped", "stopping"):
        return "exited"
    if s == "paused":
        return "running"
    return "unknown"


def image_present() -> bool:
    try:
        r = subprocess.run(
            ["podman", "image", "exists", IMAGE],
            capture_output=True, timeout=5,
        )
        return r.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
