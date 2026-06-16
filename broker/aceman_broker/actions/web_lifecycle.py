"""Actions that affect the broker / web-container lifecycle itself.

``broker.shutdown`` exits the broker asynchronously after returning
the reply (needed by the "Restart everything" path — the bootstrap
gates on the socket being absent, so we must die for a fresh broker
to be spawned).

``web.restart`` is the host-side handle the web in container-mode
uses to ask "podman restart" us — it can't restart itself.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time

from ..config import WEB_NAME
from ..engine_ops import container_running_named
from ..logging_util import _log, _safe
from . import register as _register


def action_broker_shutdown(params: "dict | None" = None) -> dict:
    """Terminate the broker itself, asynchronously."""
    def _kill_self():
        time.sleep(0.2)   # let the JSON reply flush back to the caller
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Thread(target=_kill_self, daemon=True,
                     name="broker-shutdown").start()
    _log("main", "broker.shutdown: SIGTERM scheduled (200 ms)")
    return {"shutting_down": True}


def action_web_restart(params: "dict | None" = None) -> dict:
    if not container_running_named(WEB_NAME):
        raise RuntimeError(
            f"web container {WEB_NAME!r} is not running — nothing to restart")
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
    return {"restarted": True, "container": WEB_NAME}


def register(actions: dict) -> None:
    _register(actions, "broker.shutdown", action_broker_shutdown)
    _register(actions, "web.restart", action_web_restart)
