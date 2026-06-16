"""Direct HTTP client to the Ace Stream engine.

Mirrors the shell ``aceman`` helpers:

  * ``engine_probe(url)``      — light HEAD-ish check used by the UI
                                  poller and the idle watcher.
  * ``engine_getstream(...)``  — request a new stream session, return
                                  ``(playback_url, command_url)``.
  * ``_release_engine_session(cmd_url)`` — hit ``?method=stop`` so the
                                  engine drops the session immediately.
  * ``_force_engine(...)``     — rewrite an engine-controlled URL so the
                                  scheme + authority are always ours.

The engine binary is treated as adversarial:
  * Response body capped at ``MAX_ENGINE_BYTES``.
  * Strict UTF-8, strict dict-shaped JSON.
  * Control bytes in returned URLs are refused.
  * Returned scheme + authority are forcibly rewritten to the engine
    URL we configured — the response controls only the path+query.
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request

from .constants import CTRL, HEX40, MAX_ENGINE_BYTES
from .log_util import _sanitize_msg


class EngineError(Exception):
    """Anything wrong with the engine: unreachable, malformed response,
    refused session, hostile bytes in returned URLs. Used by handlers
    as a single catch-all for "the engine layer failed"."""


def _force_engine(engine: str, url: str) -> str:
    """Replace whatever scheme+authority the engine claims with the one
    we actually configured. The response controls only the path+query.
    Same idea as the aceman shell's ``force_engine`` helper."""
    if not url.startswith("http://"):
        raise EngineError("URL scheme must be http")
    rest = url[len("http://"):]
    _, _, path = rest.partition("/")
    return f"{engine.rstrip('/')}/{path}"


def engine_probe(engine: str, timeout: float = 5.0) -> bool:
    try:
        with urllib.request.urlopen(
            f"{engine}/webui/api/service?method=get_version", timeout=timeout
        ) as r:
            r.read(1024)
        return True
    except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError):
        return False


def _release_engine_session(
        command_url: "str | None", timeout: float = 4.0) -> None:
    """Fire ``command_url?method=stop`` so the engine drops the session
    immediately. Best-effort: invalid URL / network error / engine-down
    all swallowed silently — the caller is on a teardown path where
    raising would only add noise. The next ``/ace/getstream`` is what
    we care about, and once this returns the engine has cleared its
    single-active slot."""
    if not command_url:
        return
    sep = "&" if "?" in command_url else "?"
    try:
        with urllib.request.urlopen(
                command_url + sep + "method=stop", timeout=timeout) as r:
            r.read(1024)
    except (urllib.error.URLError, OSError, TimeoutError, socket.timeout):
        pass


def engine_getstream(engine: str, content_id: str) -> "tuple[str, str | None]":
    """Open a stream session on the engine, return the rewritten
    ``(playback_url, command_url)`` pair. Raises :class:`EngineError`
    on any malformed / refused response."""
    if not HEX40.match(content_id):
        raise EngineError("content id must be 40 hex chars")
    q = urllib.parse.urlencode({"id": content_id, "format": "json"})
    url = f"{engine}/ace/getstream?{q}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            raw = r.read(MAX_ENGINE_BYTES + 1)
    except urllib.error.URLError as e:
        raise EngineError(f"engine request failed: {e.reason}") from e
    except (TimeoutError, socket.timeout) as e:
        raise EngineError("engine request timed out") from e
    if len(raw) > MAX_ENGINE_BYTES:
        raise EngineError("engine response exceeded size cap")
    try:
        payload = json.loads(raw.decode("utf-8", "replace"))
    except (json.JSONDecodeError, RecursionError, ValueError) as e:
        # RecursionError covers a pathologically deep nested-object body
        # from a compromised engine that would otherwise crash the
        # handler thread; ValueError is the bare fallback the json
        # module reserves.
        raise EngineError(
            f"engine response was not JSON: {_sanitize_msg(str(e))}") from e
    if not isinstance(payload, dict):
        raise EngineError("engine response was not a JSON object")

    err = payload.get("error")
    if err:
        raise EngineError(f"engine refused: {_sanitize_msg(str(err))}")

    resp = payload.get("response") or {}
    pb = resp.get("playback_url") or ""
    cmd = resp.get("command_url") or ""
    if not pb:
        raise EngineError("no playback_url in engine response")
    if CTRL.search(pb) or (cmd and CTRL.search(cmd)):
        raise EngineError("engine URL contained control bytes")
    pb = _force_engine(engine, pb)
    cmd = _force_engine(engine, cmd) if cmd else None
    return pb, cmd
