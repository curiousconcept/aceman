"""GET routes for web-container info (memory usage, etc.)."""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router


def web_memory(req: Request, ctx: RouteContext) -> Response:
    if not ctx.web_client:
        return Response.json(200, {"available": False})
    return Response.json(200, ctx.web_client.memory())


def register(router: Router) -> None:
    router.get("/api/web/memory", web_memory)
