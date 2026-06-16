"""GET /api/search?q=… — proxied search-ace.stream query."""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router
from ..search import SearchError


def search(req: Request, ctx: RouteContext) -> Response:
    if not ctx.search_proxy:
        return Response.error(404, "search disabled")
    q = (req.query.get("q") or "").strip()
    # First length cap before the proxy sees it, so we don't burn CPU
    # normalising long garbage queries. SearchProxy caps again at
    # MAX_QUERY_LEN.
    if len(q) > 200:
        return Response.error(400, "query too long")
    try:
        results = ctx.search_proxy.search(q)
    except SearchError as e:
        return Response.error(502, str(e))
    return Response.json(200, {"results": results})


def register(router: Router) -> None:
    router.get("/api/search", search)
