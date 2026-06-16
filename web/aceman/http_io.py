"""HTTP request/response data classes used by the router.

The point of these is testability: a route function can be invoked
with a plain :class:`Request` literal and asserts run on the returned
:class:`Response`, with no real socket, no
``BaseHTTPRequestHandler`` subclass, no ThreadingHTTPServer.

``Request`` carries everything a route needs to make a decision (path,
parsed query, parsed body, headers, path-params). ``Response`` carries
everything the framing layer needs to send the answer back (status,
headers, body bytes). The Handler is a thin glue between sockets and
these two classes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Mapping


@dataclass
class Request:
    """Inbound HTTP request, decoded and ready for route logic."""

    method: str
    path: str
    query: dict = field(default_factory=dict)
    body: dict = field(default_factory=dict)
    headers: Mapping = field(default_factory=dict)
    path_params: dict = field(default_factory=dict)


@dataclass
class Response:
    """What a route returns. The Handler turns this into bytes on the
    wire."""

    status: int
    body: bytes = b""
    content_type: str = "application/json; charset=utf-8"
    extra_headers: dict = field(default_factory=dict)

    @classmethod
    def json(cls, status: int, payload) -> "Response":
        return cls(
            status=status,
            body=json.dumps(payload).encode("utf-8"),
            content_type="application/json; charset=utf-8",
        )

    @classmethod
    def error(cls, status: int, message: str) -> "Response":
        return cls.json(status, {"error": message})

    @classmethod
    def empty(cls, status: int = 204) -> "Response":
        return cls(status=status, body=b"",
                   content_type="application/json; charset=utf-8")
