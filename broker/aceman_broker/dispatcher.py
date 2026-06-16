"""Per-connection request handler.

One JSON line in → one JSON line out → close. The dispatcher rejects:
  * receive timeouts (CONN_TIMEOUT)
  * oversize requests (MAX_REQ_BYTES — 4 KiB; one JSON object,
    plenty of headroom)
  * non-UTF-8 / non-JSON bodies
  * non-object payloads
  * non-string action names
  * unknown actions (the ACTIONS dict IS the authority surface)
  * non-object params

Action handlers raising ``RuntimeError`` / ``ValueError`` / ``OSError``
are turned into ``{"ok": false, "error": ...}`` replies; any other
exception class propagates so a future bug isn't silenced into the
wire.
"""

from __future__ import annotations

import json
import socket

from .actions import build_registry
from .config import CONN_TIMEOUT, MAX_REQ_BYTES
from .logging_util import _log, _safe


# Built once at module-import. The action handlers each registered
# themselves via `actions/__init__.py`'s registry.
ACTIONS = build_registry()


def _reply(conn: socket.socket, **payload) -> None:
    try:
        conn.sendall(json.dumps(payload).encode("utf-8") + b"\n")
    except (OSError, BrokenPipeError):
        pass


def handle(conn: socket.socket) -> None:
    try:
        conn.settimeout(CONN_TIMEOUT)
        buf = b""
        while b"\n" not in buf:
            try:
                chunk = conn.recv(MAX_REQ_BYTES)
            except (socket.timeout, OSError):
                _reply(conn, ok=False, error="receive timed out")
                return
            if not chunk:
                break
            buf += chunk
            if len(buf) > MAX_REQ_BYTES:
                _reply(conn, ok=False, error="request too large")
                return
        line = buf.split(b"\n", 1)[0]
        if not line:
            _reply(conn, ok=False, error="empty request")
            return
        try:
            req = json.loads(line.decode("utf-8", errors="strict"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            _reply(conn, ok=False, error="invalid JSON")
            return
        if not isinstance(req, dict):
            _reply(conn, ok=False, error="request must be a JSON object")
            return
        action = req.get("action")
        if not isinstance(action, str) or action not in ACTIONS:
            _reply(conn, ok=False, error="unknown action")
            return
        params = req.get("params")
        if params is not None and not isinstance(params, dict):
            _reply(conn, ok=False, error="params must be a JSON object")
            return
        _log("req", "%s", action)
        try:
            result = ACTIONS[action](params or {})
        except (RuntimeError, OSError, ValueError) as e:
            _log(action, "failed: %s", e)
            _reply(conn, ok=False, error=_safe(str(e)))
            return
        _reply(conn, ok=True, result=result)
    finally:
        try:
            conn.close()
        except OSError:
            pass
