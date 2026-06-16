"""GET / POST /api/config — server-side preference store."""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router


def get_config(req: Request, ctx: RouteContext) -> Response:
    if not ctx.config:
        return Response.error(404, "server-side config disabled")
    return Response.json(200, ctx.config.snapshot())


def patch_config(req: Request, ctx: RouteContext) -> Response:
    """Accept a flat dict of key→value pairs; Config.update validates
    each key against the allowed schema and raises ValueError on
    unknown / wrong-type values.

    Extra semantic check: if ``default_player`` is set, it must match
    a player the broker actually detected on the host — saving
    ``default_player=mpv`` on a machine without mpv would silently
    fail at play time, so we refuse at config-write time.
    """
    from ..engine_client import EngineError
    if not ctx.config:
        return Response.error(404, "server-side config disabled")
    if not isinstance(req.body, dict) or not req.body:
        return Response.error(400, "non-empty JSON object required")
    wants_player = req.body.get("default_player")
    wants_source = req.body.get("default_player_source")
    if wants_player:
        detected: "list[dict]" = []
        if ctx.players_client:
            try:
                detected = ctx.players_client.list().get("available", [])
            except EngineError:
                detected = []
        if wants_source:
            pairs = [(p.get("name"), p.get("source")) for p in detected]
            if (wants_player, wants_source) not in pairs:
                return Response.error(
                    400,
                    f"player '{wants_player}' ({wants_source}) is not available")
        else:
            if wants_player not in [p.get("name") for p in detected]:
                return Response.error(
                    400, f"player '{wants_player}' is not available")
    try:
        new_state = ctx.config.update(req.body)
    except ValueError as e:
        return Response.error(400, str(e))
    return Response.json(200, new_state)


def register(router: Router) -> None:
    router.get("/api/config", get_config)
    router.post("/api/config", patch_config)
