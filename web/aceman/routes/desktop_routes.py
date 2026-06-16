"""GET / POST / DELETE /api/desktop-entry/app — broker-managed
desktop file + scheme handler."""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError
from ..http_io import Request, Response
from ..log_util import _log
from ..router import Router


def get_desktop_entry(req: Request, ctx: RouteContext) -> Response:
    if not ctx.desktop_entry:
        return Response.error(404, "desktop entry disabled")
    try:
        return Response.json(200, ctx.desktop_entry.status())
    except EngineError as e:
        # Soft-fail: surface the error in-band so the UI can still
        # render the row (greyed-out) instead of breaking on a 502.
        _log("desktop", "broker status failed: %s", e)
        return Response.json(200, {
            "installed": False, "path": "", "error": str(e)})


def install_desktop_entry(req: Request, ctx: RouteContext) -> Response:
    if not ctx.desktop_entry:
        return Response.error(404, "desktop entry disabled")
    # Default to claiming the scheme — preserves behaviour for any
    # caller (e.g. curl) that doesn't pass the flag. The UI is
    # explicit about it via the install modal.
    register_scheme = bool(req.body.get("register_scheme", True))
    try:
        return Response.json(
            200, ctx.desktop_entry.install(register_scheme=register_scheme))
    except EngineError as e:
        return Response.error(502, f"broker install failed: {e}")


def uninstall_desktop_entry(req: Request, ctx: RouteContext) -> Response:
    if not ctx.desktop_entry:
        return Response.error(404, "desktop entry disabled")
    try:
        return Response.json(200, ctx.desktop_entry.uninstall())
    except EngineError as e:
        return Response.error(502, f"broker uninstall failed: {e}")


def register(router: Router) -> None:
    router.get("/api/desktop-entry/app", get_desktop_entry)
    router.post("/api/desktop-entry/app", install_desktop_entry)
    router.delete("/api/desktop-entry/app", uninstall_desktop_entry)
