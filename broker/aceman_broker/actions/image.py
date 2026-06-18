"""Engine image build / remove actions.

Build runs in a background thread; status() reports current state +
log tail. Locked so two clicks racing into install() can't spawn two
builders.
"""

from __future__ import annotations

import subprocess
import threading

from ..build_state import build_state
from ..config import IMAGE, NAME, PROJECT_ROOT, RMI_TIMEOUT, STOP_TIMEOUT
from ..engine_ops import image_present
from ..logging_util import _log, _safe
from . import register as _register


_image_lock = threading.Lock()


def action_image_status(params: "dict | None" = None) -> dict:
    busy = build_state.is_busy()
    current = build_state.state()
    if not busy and current not in ("building", "failed"):
        build_state.transition(
            "installed" if image_present() else "absent")
        current = build_state.state()
    return {
        "tag": IMAGE,
        "installed": image_present(),
        "state": current,
        "error": build_state.error(),
        "log_tail": build_state.tail()[-60:],
    }


def action_image_install(params: "dict | None" = None) -> dict:
    # Match where the wrapper (container/engine/Containerfile) actually
    # expects the tarball — `container/engine/dist/engine.tar.gz`. The
    # earlier `PROJECT_ROOT / "dist" / "engine.tar.gz"` path was a stale
    # holdover from before the engine build context moved into
    # `container/engine/` and pointed users at a directory that doesn't
    # exist by convention.
    tarball = PROJECT_ROOT / "container" / "engine" / "dist" / "engine.tar.gz"
    if not tarball.is_file():
        build_state.transition(
            "failed", error=f"engine.tar.gz not found at {tarball}")
        _log("image", "install refused: %s", build_state.error())
        return action_image_status()
    with _image_lock:
        if build_state.is_busy():
            return action_image_status()
        build_state.transition("building")
        build_state.clear_log()
        t = threading.Thread(target=_build_worker, daemon=True)
        build_state.attach_thread(t)
        t.start()
    _log("image", "build started (tag=%s)", IMAGE)
    return action_image_status()


def _build_worker() -> None:
    # Build context is container/engine/ (which contains dist/),
    # NOT the project root — keeps the engine image self-contained
    # so a hypothetical bad context can't slurp the rest of the repo
    # into the image layer.
    engine_ctx = PROJECT_ROOT / "container" / "engine"
    cmd = ["podman", "build", "-t", IMAGE,
           "-f", "Containerfile", "."]
    try:
        build_state.append_line(
            f"$ {' '.join(cmd)}  (cwd={engine_ctx})")
        proc = subprocess.Popen(
            cmd,
            cwd=str(engine_ctx),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            build_state.append_line(_safe(line.rstrip()))
        rc = proc.wait()
        if rc == 0:
            build_state.transition("installed")
            _log("image", "build succeeded")
        else:
            build_state.transition(
                "failed", error=f"podman build exited {rc}")
            _log("image", "build failed rc=%d", rc)
    except FileNotFoundError as e:
        build_state.transition("failed", error=f"podman not on PATH: {e}")
        _log("image", "build failed: %s", e)
    except OSError as e:
        build_state.transition("failed", error=_safe(str(e)))
        _log("image", "build failed: %s", e)


def action_image_remove(params: "dict | None" = None) -> dict:
    # Stop and rm the container before rmi — podman refuses to remove
    # an image that's in use. Both are best-effort.
    for argv in (
        ["podman", "stop", "-t", "5", NAME],
        ["podman", "rm", "-f", NAME],
    ):
        try:
            subprocess.run(argv, capture_output=True, timeout=STOP_TIMEOUT)
        except (FileNotFoundError, subprocess.TimeoutExpired) as e:
            _log("image", "container cleanup before rmi failed: %s", e)
    try:
        r = subprocess.run(
            ["podman", "rmi", "-f", IMAGE],
            capture_output=True, text=True, timeout=RMI_TIMEOUT,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return {"removed": False, "error": _safe(str(e))}
    if r.returncode != 0:
        err = _safe((r.stderr or r.stdout or "podman rmi failed").strip())
        _log("image", "rmi failed: %s", err)
        return {"removed": False, "error": err}
    build_state.clear_log()
    build_state.transition("absent")
    _log("image", "image removed (tag=%s)", IMAGE)
    return {"removed": True}


def register(actions: dict) -> None:
    _register(actions, "image.status", action_image_status)
    _register(actions, "image.install", action_image_install)
    _register(actions, "image.remove", action_image_remove)
