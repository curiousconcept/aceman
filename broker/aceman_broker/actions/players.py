"""Player detection + control actions.

Probes run on every ``players.list`` — they're a handful of cheap
``shutil.which`` / ``flatpak info`` calls, and detecting post-install
changes without a broker restart is worth it.

``player.stop`` is the security-critical bit: we SIGTERM the wrapper
PID found in the active.pid file, but only after a PID-reuse guard
verifies the process is actually aceman-related. Without that guard a
recycled PID could let us signal an unrelated user process.
"""

from __future__ import annotations

import os
import platform
import shutil
import signal
import time

from ..flatpak import has_flatpak_app
from ..logging_util import _log
from ..wrapper import read_wrapper_pid, pid_matches_aceman
from . import register as _register


PLATFORM = platform.system().lower()


# ---- per-OS probes -----------------------------------------------------

def _probe_linux_vlc():
    out = []
    if shutil.which("vlc"):
        out.append({"name": "vlc", "source": "system"})
    if has_flatpak_app("org.videolan.VLC"):
        out.append({"name": "vlc", "source": "flatpak"})
    return out


def _probe_linux_mpv():
    out = []
    if shutil.which("mpv"):
        out.append({"name": "mpv", "source": "system"})
    if has_flatpak_app("io.mpv.Mpv"):
        out.append({"name": "mpv", "source": "flatpak"})
    return out


# macOS / Windows probes ship later — stubs keep the dispatch table
# uniform so the action's response shape doesn't depend on platform.
def _probe_macos_vlc():   return []
def _probe_macos_mpv():   return []
def _probe_macos_iina():  return []
def _probe_windows_vlc(): return []
def _probe_windows_mpv(): return []
def _probe_windows_mpchc(): return []


_PROBES = {
    "linux":   [_probe_linux_vlc, _probe_linux_mpv],
    "darwin":  [_probe_macos_vlc, _probe_macos_mpv, _probe_macos_iina],
    "windows": [_probe_windows_vlc, _probe_windows_mpv, _probe_windows_mpchc],
}


# ---- actions -----------------------------------------------------------

def action_players_list(params: "dict | None" = None) -> dict:
    available: "list[dict]" = []
    for probe in _PROBES.get(PLATFORM, []):
        try:
            rows = probe()
        except OSError as e:
            _log("players", "probe %s failed: %s", probe.__name__, e)
            continue
        if rows:
            available.extend(rows)
    return {"platform": PLATFORM, "available": available}


def action_player_stop(params: "dict | None" = None) -> dict:
    """SIGTERM the wrapper PID, with PID-reuse guard. Returns
    ``{"stopped": True/False, "reason": ...}`` — never raises."""
    pid = read_wrapper_pid()
    if pid is None:
        return {"stopped": False, "reason": "no active session"}
    if pid == os.getpid():
        return {"stopped": False, "reason": "pid not signalable"}
    if not pid_matches_aceman(pid):
        return {"stopped": False, "reason": "pid is not aceman"}
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return {"stopped": False, "reason": "process gone"}
    except PermissionError as e:
        return {"stopped": False, "reason": f"kill denied: {e}"}
    _log("players", "player.stop: SIGTERM sent to wrapper pid %d", pid)
    # Block until the wrapper actually exits — see action commentary in
    # the original monolith.
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return {"stopped": True, "pid": pid}
        time.sleep(0.05)
    _log("players",
         "player.stop: wrapper %d ignored SIGTERM, escalating", pid)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    time.sleep(0.2)
    return {"stopped": True, "pid": pid, "escalated": True}


def register(actions: dict) -> None:
    _register(actions, "players.list", action_players_list)
    _register(actions, "player.stop", action_player_stop)
