"""POST /api/heartbeat — the idle-shutdown watcher's ping."""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router


def heartbeat(req: Request, ctx: RouteContext) -> Response:
    ctx.heartbeat.ping()
    return Response.json(200, {"ok": True})


def register(router: Router) -> None:
    router.post("/api/heartbeat", heartbeat)
