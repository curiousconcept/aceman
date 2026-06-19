"""GET / POST routes for the engine container lifecycle (excluding
the in-progress image build, which lives in its own module because
of its polling behaviour)."""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError, engine_probe
from ..http_io import Request, Response
from ..router import Router


def engine_probe_route(req: Request, ctx: RouteContext) -> Response:
    return Response.json(200, {"up": engine_probe(ctx.engine)})


def engine_status(req: Request, ctx: RouteContext) -> Response:
    if not ctx.engine_mgr:
        return Response.error(404, "engine management disabled")
    s = ctx.engine_mgr.status()
    # Annotate with image presence so the UI can grey the Start button
    # when there's nothing to start. Cheap, same response shape.
    if ctx.image_mgr:
        img = ctx.image_mgr.status()
        s = {**s,
             "image_installed": img.get("installed", False),
             "image_state": img.get("state", "unknown")}
    else:
        s = {**s, "image_installed": True, "image_state": "unknown"}
    # Pending-play handoff: when a second wrapper invocation has
    # queued a cid via POST /api/play-request, surface it here so the
    # currently-open tab's existing 4 s status poll picks it up. The
    # first tab to POST /api/play-request/claim wins; subsequent
    # tabs see an empty value and don't act.
    s["pending_play_cid"] = ctx.pending_play_cid_peek()
    return Response.json(200, s)


def engine_start(req: Request, ctx: RouteContext) -> Response:
    if not ctx.engine_mgr:
        return Response.error(404, "engine management disabled")
    try:
        return Response.json(200, ctx.engine_mgr.start())
    except EngineError as e:
        return Response.error(502, str(e))


def engine_stop(req: Request, ctx: RouteContext) -> Response:
    if not ctx.engine_mgr:
        return Response.error(404, "engine management disabled")
    try:
        return Response.json(200, ctx.engine_mgr.stop())
    except EngineError as e:
        return Response.error(502, str(e))


def register(router: Router) -> None:
    router.get("/api/engine/probe", engine_probe_route)
    router.get("/api/engine/status", engine_status)
    router.post("/api/engine/start", engine_start)
    router.post("/api/engine/stop", engine_stop)
