"""GET / POST / DELETE /api/history."""

from __future__ import annotations

from ..constants import HEX40
from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router


def list_history(req: Request, ctx: RouteContext) -> Response:
    if not ctx.history_store:
        return Response.error(404, "server-side storage disabled")
    raw = req.query.get("limit", "")
    try:
        limit = int(raw) if raw else None
    except ValueError:
        limit = None
    return Response.json(200, ctx.history_store.list(limit))


def record_history(req: Request, ctx: RouteContext) -> Response:
    if not ctx.history_store:
        return Response.error(404, "server-side storage disabled")
    if not isinstance(req.body, dict):
        return Response.error(400, "json body required")
    cid = (req.body.get("cid") or "").strip().lower()
    name = (req.body.get("name") or "").strip()
    if not HEX40.match(cid) or not name:
        return Response.error(400, "cid (40 hex) and non-empty name required")
    ctx.history_store.record(cid, name)
    return Response.json(200, {"ok": True})


def delete_history(req: Request, ctx: RouteContext) -> Response:
    if not ctx.history_store:
        return Response.error(404, "server-side storage disabled")
    cid = req.path_params.get("cid", "").lower()
    if not ctx.history_store.delete(cid):
        return Response.error(404, "not found")
    return Response.json(200, {"ok": True})


def clear_history(req: Request, ctx: RouteContext) -> Response:
    if not ctx.history_store:
        return Response.error(404, "server-side storage disabled")
    ctx.history_store.clear()
    return Response.json(200, {"ok": True})


def register(router: Router) -> None:
    router.get("/api/history", list_history)
    router.post("/api/history", record_history)
    router.delete("/api/history", clear_history)
    router.delete("/api/history/{cid}", delete_history)
