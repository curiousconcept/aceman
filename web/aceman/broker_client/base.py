"""Thin unix-socket client for aceman-broker.

The broker is a host-side process that owns the podman allow-list:
start/stop/status the engine container, build/remove the image, write
the desktop entry, etc. It listens on a unix socket at
``$XDG_RUNTIME_DIR/aceman/broker.sock`` (0600, owning-UID-only), one
JSON request per connection, one JSON reply, close.

The web frontend never talks to podman directly — even when it runs
on the host today, this client is the only privileged-op path. When
the frontend moves into its own container, the only thing it needs
from the host is a bind-mount of this single socket.
"""

from __future__ import annotations

import json
import pathlib
import socket

from ..engine_client import EngineError
from ..log_util import _sanitize_msg


class BrokerError(EngineError):
    """Raised when the broker socket is unreachable or returns
    ``{"ok": false, ...}``. Subclasses :class:`EngineError` so the
    HTTP handlers' existing ``except EngineError`` branches catch it
    without special-casing — the UI just sees an engine-management
    failure with a useful message."""


class BrokerClient:
    """One JSON line in, one JSON reply out. Each ``call`` opens a
    fresh socket; the broker handles its own connection lifecycle.

    Replies are size-capped (:attr:`MAX_REPLY_BYTES`) and required to
    be JSON-shaped dicts. ``{"ok": false}`` raises :class:`EngineError`
    (not :class:`BrokerError`) so it lands in the same handler branch
    as direct engine failures — the user sees "engine refused: …"
    regardless of where the refusal originated.
    """

    MAX_REPLY_BYTES = 64 * 1024

    def __init__(self, socket_path: pathlib.Path) -> None:
        self.socket_path = socket_path

    def call(self, action: str, *, params: "dict | None" = None,
             timeout: float = 30.0) -> dict:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            s.settimeout(timeout)
            try:
                s.connect(str(self.socket_path))
            except (FileNotFoundError, ConnectionRefusedError) as e:
                raise BrokerError(
                    f"broker not running at {self.socket_path} "
                    f"(restart via the aceman_web wrapper, "
                    f"which auto-spawns it; or run "
                    f"./broker/aceman-broker directly to see its logs)"
                ) from e
            except OSError as e:
                raise BrokerError(f"broker connect failed: {e}") from e
            req: dict = {"action": action}
            if params:
                req["params"] = params
            try:
                s.sendall((json.dumps(req) + "\n").encode("utf-8"))
            except OSError as e:
                raise BrokerError(f"broker send failed: {e}") from e
            buf = b""
            while True:
                try:
                    chunk = s.recv(8192)
                except socket.timeout as e:
                    raise BrokerError("broker reply timed out") from e
                except OSError as e:
                    raise BrokerError(f"broker recv failed: {e}") from e
                if not chunk:
                    break
                buf += chunk
                if len(buf) > self.MAX_REPLY_BYTES:
                    raise BrokerError("broker reply too large")
        finally:
            try:
                s.close()
            except OSError:
                pass
        try:
            reply = json.loads(buf.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise BrokerError(f"broker reply not JSON: {e}") from e
        if not isinstance(reply, dict):
            raise BrokerError("broker reply was not an object")
        if not reply.get("ok"):
            # Broker already sanitised its error string; pass through.
            raise EngineError(
                _sanitize_msg(str(reply.get("error") or "broker error")))
        result = reply.get("result")
        return result if isinstance(result, dict) else {}
