"""GET /api/players — host-side player probe via the broker."""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError
from ..http_io import Request, Response
from ..log_util import _log
from ..router import Router


def list_players(req: Request, ctx: RouteContext) -> Response:
    if not ctx.players_client:
        return Response.error(404, "player detection disabled")
    try:
        return Response.json(200, ctx.players_client.list())
    except EngineError as e:
        # Degrade to "no players known" rather than 502 — the UI
        # renders an empty list gracefully and the user just sees
        # "no supported player found".
        _log("players", "broker call failed: %s", e)
        return Response.json(
            200, {"platform": "unknown", "available": []})


def register(router: Router) -> None:
    router.get("/api/players", list_players)
