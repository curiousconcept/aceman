"""Actions that affect the broker / web-container lifecycle itself.

``broker.shutdown`` exits the broker asynchronously after returning
the reply (needed by the "Restart everything" path — the bootstrap
gates on the socket being absent, so we must die for a fresh broker
to be spawned).

``broker.respawn`` exec's the broker into a fresh copy of itself
so a `git pull` + Restart picks up broker-side changes without a
manual ``aceman_web --stop`` + relaunch. Guarded by an import
pre-flight (see action body) so a syntax error in the new code
doesn't leave the operator with no broker.

``web.restart`` is the host-side handle the web in container-mode
uses to ask "podman restart" us — it can't restart itself.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import threading
import time

from ..config import IMAGE, PROJECT_ROOT, WEB_IMAGE, WEB_NAME
from ..engine_ops import container_running_named, image_commit_label
from ..logging_util import _log, _safe
from .restart_helpers import pick_up_image_changes, recreate_container
from . import register as _register


def _current_head_sha() -> str:
    """Resolve PROJECT_ROOT's git HEAD to a full sha. Empty if we're
    not in a git repo. No `git rev-parse --verify` because we just
    want the user's "now" — if the repo has been moved or rewritten,
    the user is in an unusual state and we'd rather say "unknown"
    than guess."""
    try:
        r = subprocess.run(
            ["git", "-C", str(PROJECT_ROOT), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=3,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""
    if r.returncode != 0:
        return ""
    return (r.stdout or "").strip()


def action_restart_preflight(params: "dict | None" = None) -> dict:
    """Report whether the running images are behind the on-disk
    source. The web UI's Restart modal uses this to decide whether to
    paint the "new changes detected" warning next to the Rebuild
    checkbox.

    `rebuild_recommended` is True when either image's stamped
    aceman.commit label doesn't match the current HEAD sha (or the
    image has no label at all — built before this scheme existed).
    Outside a git repo we return rebuild_recommended=False; we can't
    tell, so we shouldn't nudge.
    """
    current = _current_head_sha()
    engine_label = image_commit_label(IMAGE)
    web_label = image_commit_label(WEB_IMAGE)
    engine_drift = bool(current) and engine_label != current
    web_drift = bool(current) and web_label != current
    return {
        "current_commit": current,
        "engine_image_commit": engine_label,
        "web_image_commit": web_label,
        "rebuild_recommended": engine_drift or web_drift,
    }


# Path to the entry script the broker was launched from. Used by
# action_broker_respawn so the exec'd process is the same shape
# (same wrapper, same prctl name) as the original. Pinned at import
# time so a malicious request can't redirect it.
_BROKER_SCRIPT: pathlib.Path = PROJECT_ROOT / "broker" / "aceman-broker"
# Where ``aceman_broker.main`` lives, for the preflight import probe.
_BROKER_PACKAGE_DIR: pathlib.Path = PROJECT_ROOT / "broker"


def action_broker_shutdown(params: "dict | None" = None) -> dict:
    """Terminate the broker itself, asynchronously."""
    def _kill_self():
        time.sleep(0.2)   # let the JSON reply flush back to the caller
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Thread(target=_kill_self, daemon=True,
                     name="broker-shutdown").start()
    _log("main", "broker.shutdown: SIGTERM scheduled (200 ms)")
    return {"shutting_down": True}


def action_broker_respawn(params: "dict | None" = None) -> dict:
    """Replace the broker process in place with a fresh copy that
    reads the on-disk code from scratch — used by ``/api/restart`` so
    a ``git pull`` + Restart cycle picks up broker-side changes
    without making the operator run ``aceman_web --stop`` first.

    Pre-flight: launch a throwaway ``python -c "import
    aceman_broker.main"`` to confirm the new code at least loads.
    If it doesn't (syntax error, broken import), refuse the
    respawn — the working broker stays up. The
    operator sees the reason in the JSON reply and the broker log,
    fixes the source, and tries again. Cheap insurance (~200 ms
    fork + import) against the worst failure mode where bad code
    lands and the operator is suddenly stuck without a broker.
    """
    preflight_cmd = (
        f"import sys; sys.path.insert(0, {str(_BROKER_PACKAGE_DIR)!r}); "
        f"import aceman_broker.main"
    )
    try:
        check = subprocess.run(
            [sys.executable, "-c", preflight_cmd],
            capture_output=True, text=True, timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        _log("main", "broker.respawn: preflight failed: %s", e)
        return {"respawned": False, "reason": f"preflight failed: {e}"}

    if check.returncode != 0:
        # New code can't even be imported. Don't tear down the
        # working broker — keep serving with the OLD code so the
        # operator has something to fix the source against.
        stderr = _safe((check.stderr or check.stdout or "").strip())[:500]
        _log("main", "broker.respawn: rejected by preflight: %s", stderr)
        return {
            "respawned": False,
            "reason": "new broker code failed to import",
            "stderr": stderr,
        }

    # Pre-flight clean. Schedule the actual replacement on a daemon
    # thread so the JSON reply flushes back to the caller first.
    def _do_respawn():
        time.sleep(0.2)
        _log("main", "broker.respawn: exec'ing %s", _BROKER_SCRIPT)
        # `os.execv` replaces the whole process image — threads,
        # sockets (closed by CLOEXEC), in-memory state all go. New
        # process starts from scratch, rebinds the socket, ready
        # for the next call. Env vars and CWD are preserved.
        try:
            os.execv(sys.executable,
                     [sys.executable, str(_BROKER_SCRIPT)])
        except OSError as e:
            # If execv itself fails (file missing, perms), fall back
            # to graceful shutdown so the wrapper-side respawn path
            # (next aceman_web launch sees no socket → spawns fresh)
            # still has a way out. Limping is worse than dying.
            _log("main", "broker.respawn: execv failed: %s — SIGTERM-ing", e)
            os.kill(os.getpid(), signal.SIGTERM)
    threading.Thread(target=_do_respawn, daemon=True,
                     name="broker-respawn").start()
    _log("main", "broker.respawn: scheduled (200 ms)")
    return {"respawned": True}


def action_web_restart(params: "dict | None" = None) -> dict:
    if not container_running_named(WEB_NAME):
        raise RuntimeError(
            f"web container {WEB_NAME!r} is not running — nothing to restart")
    # `rebuild` is an explicit operator opt-in from the Restart modal's
    # tickbox. Default false so a routine restart stays cheap and the
    # foreground wrapper (terminal / desktop entry that exec'd into
    # podman run) survives. true means "I trust the source — rebuild
    # the image before bouncing"; in that case pick_up_image_changes
    # runs ensure_web_image and we recreate the container if the
    # image label actually moved.
    rebuild = bool((params or {}).get("rebuild", False))
    rebuilt = False
    if rebuild:
        # Operator ticked Rebuild — always rebuild the image AND
        # recreate the container, regardless of whether label/ID
        # drift detection thinks anything moved. A plain
        # `podman restart` keeps the old container running the old
        # layers even after a fresh `podman build` overwrites the
        # tag, so without an unconditional recreate here the
        # "Rebuild" tickbox is a lie when the working tree is dirty
        # (no label written → drift detection blind).
        pick_up_image_changes("web", WEB_IMAGE)
        _log("web", "restart: rebuild=true → recreating '%s'", WEB_NAME)
        recreate_container(WEB_NAME)
        rebuilt = True
    else:
        _log("web", "restart: '%s'", WEB_NAME)
        try:
            r = subprocess.run(
                ["podman", "restart", "-t", "5", WEB_NAME],
                capture_output=True, text=True, timeout=20,
            )
        except FileNotFoundError as e:
            raise RuntimeError(f"podman not on PATH: {e}") from e
        except subprocess.TimeoutExpired as e:
            raise RuntimeError("podman restart timed out") from e
        if r.returncode != 0:
            msg = _safe((r.stderr or r.stdout or "").strip())
            raise RuntimeError(
                f"podman restart exited {r.returncode}: {msg or '<no output>'}")
    return {"restarted": True, "container": WEB_NAME, "rebuilt": rebuilt}


def _parse_mem_str(s: str) -> int:
    """'1.5 MiB' / '512 MB' / '2 GiB' → bytes. Returns 0 on parse error."""
    m = re.match(r'([\d.]+)\s*([KMGT]?i?B)', s.strip(), re.IGNORECASE)
    if not m:
        return 0
    val = float(m.group(1))
    unit = m.group(2).upper()
    mult = {
        'B': 1,
        'KB': 1000, 'KIB': 1024,
        'MB': 1000**2, 'MIB': 1024**2,
        'GB': 1000**3, 'GIB': 1024**3,
        'TB': 1000**4, 'TIB': 1024**4,
    }
    return int(val * mult.get(unit, 1))


def action_web_memory(params: "dict | None" = None) -> dict:
    """Return current and limit memory for the web container.

    Uses ``podman stats --no-stream`` which reads the cgroup counters
    without attaching a persistent monitor. Returns
    ``{"available": False}`` when the container is not running (native
    mode, mid-restart, etc.) so the caller can hide the row silently.
    """
    if not container_running_named(WEB_NAME):
        return {"available": False}
    try:
        r = subprocess.run(
            ["podman", "stats", "--no-stream", "--format", "json", WEB_NAME],
            capture_output=True, text=True, timeout=6,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"available": False}
    if r.returncode != 0:
        return {"available": False}
    try:
        data = json.loads(r.stdout.strip())
        # podman may return a top-level list or a single object
        entry = data[0] if isinstance(data, list) else data
        mem_usage = (
            entry.get("MemUsage") or entry.get("mem_usage") or ""
        )
        parts = mem_usage.split("/")
        if len(parts) != 2:
            return {"available": False}
        mem_bytes = _parse_mem_str(parts[0])
        limit_bytes = _parse_mem_str(parts[1])
    except (json.JSONDecodeError, IndexError, KeyError, ValueError):
        return {"available": False}
    return {
        "available": True,
        "mem_bytes": mem_bytes,
        "limit_bytes": limit_bytes,
    }


def register(actions: dict) -> None:
    _register(actions, "broker.shutdown", action_broker_shutdown)
    _register(actions, "broker.respawn", action_broker_respawn)
    _register(actions, "restart.preflight", action_restart_preflight)
    _register(actions, "web.restart", action_web_restart)
    _register(actions, "web.memory", action_web_memory)
