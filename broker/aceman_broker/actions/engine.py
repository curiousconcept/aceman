"""Engine container lifecycle actions.

All state-changing podman calls are serialised under a single lock —
two concurrent "Start engine" clicks must not race into a double
spawn or stop-while-starting.
"""

from __future__ import annotations

import os
import subprocess
import threading
import time

from ..config import (
    ENGINE_URL,
    ENSURE_IMAGE_HELPER,
    IMAGE,
    LAUNCHER_TIMEOUT,
    NAME,
    RUN_SH,
    START_WAIT_SECONDS,
    STOP_TIMEOUT,
)
from ..engine_ops import (
    container_running,
    container_state,
    engine_probe,
    image_commit_label,
)
from .restart_helpers import (
    pick_up_image_changes,
    recreate_container,
)
from ..logging_util import _log, _safe
from ..validators import validate_lines
from ..wrapper import wrapper_alive, wrapper_cid
from . import register


# Serialises every state-changing engine action.
_engine_lock = threading.Lock()


import re as _re

# Engine-side noise we filter out before showing the log tail in the UI.
# Each pattern is a benign line emitted from inside the container that
# tells the operator nothing actionable but clutters the view:
#   * `/dev/disk/by-id` — engine shells out to enumerate disks for a
#     hardware fingerprint; we deliberately don't expose host devices,
#     so ls returns ENOENT every poll.
# Add patterns here as discovered. We filter on the broker, not in the
# container — the engine binary stays untouched, and the raw log is
# still available via `podman logs` for anyone investigating directly.
_ENGINE_LOG_NOISE = (
    _re.compile(r"^ls: cannot access '/dev/disk/by-id/?': "
                r"No such file or directory\s*$"),
)


def _filter_engine_noise(text: str) -> str:
    """Strip _ENGINE_LOG_NOISE lines from a log dump. Preserves order
    and the trailing-newline shape of the input modulo the dropped
    lines."""
    if not text:
        return text
    out = []
    for line in text.split("\n"):
        if any(p.match(line) for p in _ENGINE_LOG_NOISE):
            continue
        out.append(line)
    return "\n".join(out)


def action_engine_logs(params: "dict | None" = None) -> dict:
    """Tail engine container logs via ``podman logs --tail N``."""
    lines = validate_lines(
        (params or {}).get("lines"), maximum=1000, default=200)
    try:
        r = subprocess.run(
            ["podman", "logs", "--tail", str(lines), NAME],
            capture_output=True, text=True, timeout=8,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return {"path": f"podman logs {NAME}", "tail": f"({e})",
                "lines": 0, "size_bytes": 0, "available": False}
    if r.returncode != 0:
        return {"path": f"podman logs {NAME}",
                "tail": _safe(r.stderr or "container not running"),
                "lines": 0, "size_bytes": 0, "available": False}
    text = (r.stdout or "") + (r.stderr or "")
    text = _filter_engine_noise(text)
    tail = text.rstrip("\n")
    return {"path": f"podman logs {NAME}",
            "tail": tail,
            "lines": tail.count("\n") + 1 if tail else 0,
            "size_bytes": len(tail.encode("utf-8")),
            "available": True}


def action_engine_status(params: "dict | None" = None) -> dict:
    state = container_state()
    alive = wrapper_alive()
    return {
        "container": state == "running",
        "container_state": state,
        "up": engine_probe(),
        "wrapper_alive": alive,
        # The cid the wrapper is currently playing, when it's alive.
        # Lets the web UI populate the Watch input and look up the
        # name in favourites for streams that bypassed the web
        # entirely (acestream:// link → desktop entry → external
        # player). Empty when no wrapper is up.
        "wrapper_cid": wrapper_cid() if alive else "",
    }


def _start_engine_unlocked() -> dict:
    """The body of action_engine_start without the _engine_lock acquire.
    Lets action_engine_restart call into the spawn path while it
    already holds the lock (Python locks aren't reentrant).
    """
    if container_running():
        return {"started": False, "reason": "already running"}
    _log("engine", "start: spawning '%s' via %s", NAME, RUN_SH)
    env = os.environ.copy()
    env["ACE_DETACH"] = "1"
    env["ACE_NAME"] = NAME
    env["ACE_IMAGE"] = IMAGE
    try:
        r = subprocess.run(
            ["bash", str(RUN_SH)],
            env=env, capture_output=True, text=True,
            timeout=LAUNCHER_TIMEOUT,
        )
    except FileNotFoundError as e:
        raise RuntimeError(f"bash not on PATH: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("launcher timed out") from e
    if r.returncode != 0:
        msg = _safe((r.stderr or r.stdout or "").strip())
        raise RuntimeError(
            f"launcher exited {r.returncode}: {msg or '<no output>'}")
    deadline = time.monotonic() + START_WAIT_SECONDS
    while time.monotonic() < deadline:
        if engine_probe(timeout=2):
            _log("engine", "start: ready")
            return {"started": True}
        time.sleep(1)
    raise RuntimeError(
        f"container started but engine never answered at {ENGINE_URL}")


def action_engine_start(params: "dict | None" = None) -> dict:
    with _engine_lock:
        return _start_engine_unlocked()


def action_engine_stop(params: "dict | None" = None) -> dict:
    with _engine_lock:
        if not container_running():
            return {"stopped": False, "reason": "not running"}
        _log("engine", "stop: '%s'", NAME)
        try:
            subprocess.run(
                ["podman", "stop", "-t", "5", NAME],
                capture_output=True, timeout=STOP_TIMEOUT,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired) as e:
            raise RuntimeError(f"podman stop failed: {e}") from e
        return {"stopped": True}


def action_engine_restart(params: "dict | None" = None) -> dict:
    with _engine_lock:
        # `rebuild` is the explicit operator opt-in from the Restart
        # modal's tickbox. Default false keeps a routine restart cheap
        # (plain `podman restart`) and bails early if the container
        # isn't running. true means "set everything back to a known
        # clean state": build/rebuild the image, and if the container
        # was stopped or never created, START it instead of giving up.
        # That's what the operator's "Rebuild images" intent expects —
        # not "only bounce what's running".
        rebuild = bool((params or {}).get("rebuild", False))
        if not container_running():
            if not rebuild:
                return {"restarted": False, "reason": "not running"}
            # Rebuild path with no running container: ensure the image
            # is current (build from tarball if missing), then start
            # fresh. Falls back to "started" semantics — same wire
            # response shape as a restart so the UI doesn't have to
            # distinguish.
            if rebuild:
                pick_up_image_changes("engine", IMAGE)
            r = _start_engine_unlocked()
            return {"restarted": bool(r.get("started")),
                    "rebuilt": True,
                    "started_fresh": True,
                    "reason": r.get("reason")}
        image_changed = (
            pick_up_image_changes("engine", IMAGE) if rebuild else False
        )
        rebuilt = False
        if image_changed:
            _log("engine", "restart: image label moved; recreating '%s'", NAME)
            recreate_container(NAME)
            rebuilt = True
        else:
            _log("engine", "restart: '%s'", NAME)
            try:
                r = subprocess.run(
                    ["podman", "restart", "-t", "5", NAME],
                    capture_output=True, text=True, timeout=20,
                )
            except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                raise RuntimeError(f"podman restart failed: {e}") from e
            if r.returncode != 0:
                msg = _safe((r.stderr or r.stdout or "").strip())
                raise RuntimeError(
                    f"podman restart exited {r.returncode}: "
                    f"{msg or '<no output>'}")
        deadline = time.monotonic() + START_WAIT_SECONDS
        while time.monotonic() < deadline:
            if engine_probe(timeout=2):
                _log("engine", "restart: ready (rebuilt=%s)", rebuilt)
                return {"restarted": True, "rebuilt": rebuilt}
            time.sleep(1)
        raise RuntimeError(
            f"container restarted but engine never answered at {ENGINE_URL}")


def register(actions: dict) -> None:
    from . import register as _r
    _r(actions, "engine.status", action_engine_status)
    _r(actions, "engine.logs", action_engine_logs)
    _r(actions, "engine.start", action_engine_start)
    _r(actions, "engine.stop", action_engine_stop)
    _r(actions, "engine.restart", action_engine_restart)
