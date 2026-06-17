"""GET /api/storage-mode — bootstrap config the JS reads on load."""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router
from ..search import SearchProxy


def get_storage_mode(req: Request, ctx: RouteContext) -> Response:
    # search_sources is a list so the UI tooltip can show one per
    # line; today there's a single upstream, adding more later is
    # just appending to this list — no UI change.
    sources: "list[str]" = []
    if ctx.search_proxy:
        sources.append(SearchProxy.BASE)
    return Response.json(200, {
        "mode": "sqlite" if ctx.store else "browser",
        "engine": ctx.engine,
        "search_sources": sources,
        # Surfaced as the tooltip on the SQLITE badge in the
        # favourites header so the user can see exactly where their
        # data lives without diving into config files.
        "favorites_path": str(ctx.db_path) if ctx.store else None,
        # Frontend hides Linux-desktop-only affordances (App launcher,
        # acestream:// scheme handler) when this is true; the user is
        # reaching the page from a Windows browser via the WSL guest IP.
        "is_wsl": ctx.is_wsl,
    })


def register(router: Router) -> None:
    router.get("/api/storage-mode", get_storage_mode)
