"""GET / POST / DELETE / PATCH /api/favs.

The favourites store is optional (sqlite3 might be missing on the
host); when ``ctx.store`` is ``None`` these routes return 404
"server-side storage disabled" and the browser silently falls back
to localStorage. Validation rules (NAME_OK, HEX40) live in
:class:`FavStore`, so handlers here are mostly shaping
errors → HTTP responses.
"""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError
from ..favourites import DuplicateCidError
from ..http_io import Request, Response
from ..router import Router


def list_favs(req: Request, ctx: RouteContext) -> Response:
    if not ctx.store:
        return Response.error(404, "server-side storage disabled")
    return Response.json(200, ctx.store.list())


def add_fav(req: Request, ctx: RouteContext) -> Response:
    if not ctx.store:
        return Response.error(404, "server-side storage disabled")
    name = (req.body.get("name") or "").strip() if isinstance(
        req.body.get("name"), str) else ""
    cid = (req.body.get("cid") or "").strip().lower() if isinstance(
        req.body.get("cid"), str) else ""
    if not name or not cid:
        return Response.error(400, "name and cid required")
    try:
        ctx.store.add(name, cid)
    except DuplicateCidError as e:
        # 409 carries the existing name so the UI can present "already
        # saved as <name>" without making a second request.
        return Response.json(
            409, {"error": "duplicate content id",
                  "existing_name": e.existing_name})
    except ValueError as e:
        return Response.error(400, str(e))
    return Response.json(200, {"ok": True})


def touch_fav(req: Request, ctx: RouteContext) -> Response:
    if not ctx.store:
        return Response.error(404, "server-side storage disabled")
    from ..constants import HEX40
    cid = (req.body.get("cid") or "").strip().lower() if isinstance(
        req.body.get("cid"), str) else ""
    if not HEX40.match(cid):
        return Response.error(400, "cid must be 40 hex chars")
    try:
        ctx.store.touch_by_cid(cid)
    except Exception:  # noqa: BLE001 — best-effort bookkeeping
        pass
    return Response.json(200, {"ok": True})


def delete_fav(req: Request, ctx: RouteContext) -> Response:
    if not ctx.store:
        return Response.error(404, "server-side storage disabled")
    name = req.path_params.get("name", "")
    if not ctx.store.delete(name):
        return Response.error(404, f"no such favourite: {name}")
    return Response.json(200, {"ok": True})


def rename_fav(req: Request, ctx: RouteContext) -> Response:
    if not ctx.store:
        return Response.error(404, "server-side storage disabled")
    old = req.path_params.get("name", "")
    new = req.body.get("name")
    if not isinstance(new, str):
        return Response.error(400, "name required")
    try:
        ctx.store.rename(old, new)
    except KeyError:
        return Response.error(404, f"no such favourite: {old}")
    except ValueError as e:
        return Response.error(400, str(e))
    return Response.json(200, {"ok": True})


def register(router: Router) -> None:
    router.get("/api/favs", list_favs)
    router.post("/api/favs", add_fav)
    router.post("/api/favs/touch", touch_fav)
    router.delete("/api/favs/{name}", delete_fav)
    router.patch("/api/favs/{name}", rename_fav)
