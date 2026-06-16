"""GET /api/logs?kind=web|broker|engine&lines=N

Web and broker logs are read from disk; engine logs go through the
broker (``podman logs --tail N``).
"""

from __future__ import annotations

import os
import pathlib

from ..context import RouteContext
from ..engine_client import EngineError
from ..http_io import Request, Response
from ..router import Router


_LOG_TAIL_BYTES = 256 * 1024
_LOG_MAX_LINES = 2000


def _resolve_log_path(kind: str) -> "pathlib.Path | None":
    """Both web.log and broker.log live in $XDG_CACHE_HOME/aceman/.
    Returns None for unknown kinds — the caller falls back to a
    not-available response."""
    if kind not in ("web", "broker"):
        return None
    cache_dir = (
        pathlib.Path(os.environ.get("XDG_CACHE_HOME")
                     or pathlib.Path.home() / ".cache")
        / "aceman"
    )
    return cache_dir / f"{kind}.log"


def get_logs(req: Request, ctx: RouteContext) -> Response:
    try:
        req_lines = int(req.query.get("lines", "200"))
    except (TypeError, ValueError):
        req_lines = 200
    req_lines = max(1, min(req_lines, _LOG_MAX_LINES))
    kind = (req.query.get("kind") or "web").lower()

    if kind == "engine":
        if not ctx.engine_mgr:
            return Response.json(200, {
                "path": "podman logs", "tail": "", "lines": 0,
                "size_bytes": 0, "available": False,
            })
        try:
            r = ctx.engine_mgr.broker.call(
                "engine.logs", params={"lines": req_lines}, timeout=10)
        except EngineError as e:
            return Response.json(200, {
                "path": "podman logs",
                "tail": f"(broker call failed: {e})",
                "lines": 0, "size_bytes": 0, "available": False,
            })
        return Response.json(200, r)

    log_path = _resolve_log_path(kind)
    if log_path is None:
        return Response.error(400, "unknown log kind")
    if not log_path.is_file():
        return Response.json(200, {
            "path": str(log_path), "tail": "", "lines": 0,
            "size_bytes": 0, "available": False,
        })
    try:
        size = log_path.stat().st_size
        with open(log_path, "rb") as f:
            read = min(size, _LOG_TAIL_BYTES)
            f.seek(size - read)
            blob = f.read(read)
    except OSError:
        return Response.error(500, "log read failed")
    text = blob.decode("utf-8", errors="replace")
    # If we read from a partial line at the start, drop it so the
    # output begins on a clean line boundary.
    if read < size:
        text = text.split("\n", 1)[1] if "\n" in text else text
    all_lines = text.splitlines()
    tail = all_lines[-req_lines:]
    return Response.json(200, {
        "path": str(log_path),
        "tail": "\n".join(tail),
        "lines": len(tail),
        "size_bytes": size,
        "available": True,
    })


def register(router: Router) -> None:
    router.get("/api/logs", get_logs)
