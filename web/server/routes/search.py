"""GET /api/search?q=… — multi-source search.

Queries every enabled + available source (search-ace.stream proxy and/or
the engine's own /search), merges the results into one deduped set, and
returns them in the source-agnostic ``{cid, name, translated_name}``
shape. Sources are best-effort: one dead source doesn't sink the others.
"""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router
from ..search import SearchError
from ..search_engine import engine_search
from ..search_merge import merge_results


def _flag(ctx: RouteContext, key: str, default: bool) -> bool:
    if ctx.config:
        v = ctx.config.get(key, default)
        return v if isinstance(v, bool) else default
    return default


def _enabled_sources(ctx: RouteContext, q: str) -> "list[tuple[str, object]]":
    """(name, callable) for each source BOTH enabled in config and actually
    available."""
    sources: "list[tuple[str, object]]" = []
    if _flag(ctx, "search_aceproxy", True) and ctx.search_proxy:
        sources.append(("aceproxy", lambda: ctx.search_proxy.search(q)))
    if _flag(ctx, "search_engine", False) and ctx.engine:
        sources.append(("engine", lambda: engine_search(ctx.engine, q)))
    return sources


def search(req: Request, ctx: RouteContext) -> Response:
    q = (req.query.get("q") or "").strip()
    # First length cap before any source sees it, so we don't burn CPU
    # normalising long garbage. Each source caps again internally.
    if len(q) > 200:
        return Response.error(400, "query too long")

    sources = _enabled_sources(ctx, q)
    if not sources:
        return Response.error(404, "search disabled")

    lists: "list[list[dict]]" = []
    errors: "list[str]" = []
    for _name, fn in sources:
        try:
            lists.append(fn())
        except SearchError as e:
            errors.append(str(e))
    # Hard error only if EVERY enabled source failed; otherwise a partial
    # result beats a 502.
    if not lists:
        return Response.error(502, "; ".join(errors) or "search failed")
    return Response.json(200, {"results": merge_results(lists)})


def register(router: Router) -> None:
    router.get("/api/search", search)
