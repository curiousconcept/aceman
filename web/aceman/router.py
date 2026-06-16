"""Tiny method+path router.

Replaces the ``if/elif`` chain in ``Handler.do_GET/do_POST``. A route
is registered with a method, a path pattern, and a handler function
that takes ``(request, ctx) -> Response``.

Patterns use Python's ``str.format``-ish notation with named segments::

    "/api/favs/{name}"

…which matches one path segment (no slash) and surfaces it as
``request.path_params["name"]``. We deliberately do NOT support
regex-style patterns or optional segments — every route in this app
is shallow enough that the simpler grammar covers it, and a richer
grammar would invite the security mistakes the router exists to
avoid (path-component traversal, ambiguous matches, prefix matches
across slash boundaries).
"""

from __future__ import annotations

import re
import urllib.parse
from typing import Callable

from .context import RouteContext
from .http_io import Request, Response


# A route function takes the request + context and returns a response.
RouteFn = Callable[[Request, RouteContext], Response]


class Router:
    """Map (method, path) to a RouteFn. Path patterns may contain
    ``{name}``-style segments that capture into ``path_params``."""

    _SEG_RE = re.compile(r"\{([A-Za-z_][A-Za-z_0-9]*)\}")

    def __init__(self) -> None:
        # Per-method list of (compiled_regex, param_names, fn).
        # Lookup is linear because we only ever register ~30 routes.
        self._routes: "dict[str, list[tuple[re.Pattern, list[str], RouteFn]]]" = {}

    def add(self, method: str, pattern: str, fn: RouteFn) -> None:
        params: "list[str]" = []

        def _sub(m):
            params.append(m.group(1))
            # One path segment — no slashes allowed inside a single
            # `{name}`. This is the security-critical line: without
            # the "no slash" anchor, a name like `..%2Fetc%2Fpasswd`
            # could match a route expecting just "{name}" and the
            # route handler would see the full path-traversal string.
            return r"(?P<%s>[^/]+)" % m.group(1)

        regex = re.compile("^" + self._SEG_RE.sub(_sub, pattern) + "$")
        self._routes.setdefault(method, []).append((regex, params, fn))

    def get(self, p, fn):    self.add("GET", p, fn)
    def post(self, p, fn):   self.add("POST", p, fn)
    def delete(self, p, fn): self.add("DELETE", p, fn)
    def patch(self, p, fn):  self.add("PATCH", p, fn)

    def resolve(self, method: str, path: str) -> "tuple[RouteFn, dict] | None":
        """Return ``(fn, path_params)`` for the first matching route, or
        ``None`` if nothing matches."""
        for regex, params, fn in self._routes.get(method, []):
            m = regex.match(path)
            if m:
                pp = {n: urllib.parse.unquote(m.group(n)) for n in params}
                return fn, pp
        return None
