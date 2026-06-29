"""GET /api/storage-mode — bootstrap config the JS reads on load."""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router
from ..search import SearchProxy


def get_storage_mode(req: Request, ctx: RouteContext) -> Response:
    # search_sources lists every enabled + available source (the UI shows
    # one per line). Same enable/availability rule the search route uses
    # (routes/search._enabled_sources).
    def _flag(key, default):
        v = ctx.config.get(key, default) if ctx.config else default
        return v if isinstance(v, bool) else default

    sources: "list[str]" = []
    if _flag("search_aceproxy", True) and ctx.search_proxy:
        sources.append(SearchProxy.BASE)
    if _flag("search_engine", False) and ctx.engine:
        sources.append(ctx.engine.rstrip("/") + "/search")
    return Response.json(200, {
        "mode": "sqlite" if ctx.store else "browser",
        "engine": ctx.engine,
        "search_sources": sources,
        # Surfaced as the tooltip on the SQLITE badge in the
        # favourites header so the user can see exactly where their
        # data lives without diving into config files.
        "favorites_path": str(ctx.db_path) if ctx.store else None,
        # Frontend hides Linux-desktop-only affordances (App launcher,
        # acestream:// scheme handler) when this is true: the page is
        # served to a browser on another host (WSL, a Lima VM, a remote
        # box), so a local Linux desktop action can't take effect.
        "no_local_desktop": ctx.no_local_desktop,
    })


def register(router: Router) -> None:
    router.get("/api/storage-mode", get_storage_mode)
