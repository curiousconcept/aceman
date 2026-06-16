"""Tests for the path router itself.

Critical security property: a path-parameter pattern must capture
exactly ONE path segment. A regression that lets ``{name}`` match
across slashes would let an attacker send DELETE /api/favs/..%2Fsystem
and have the route handler see ``../system`` as the favourite name.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

from aceman.http_io import Request, Response
from aceman.router import Router


def _ok(req, ctx): return Response.json(200, {"path": req.path,
                                              "params": req.path_params})


class RouterMatchingTests(unittest.TestCase):
    def setUp(self):
        self.r = Router()

    def test_static_match(self):
        self.r.get("/api/foo", _ok)
        match = self.r.resolve("GET", "/api/foo")
        self.assertIsNotNone(match)
        self.assertEqual(match[1], {})

    def test_no_match_returns_none(self):
        self.r.get("/api/foo", _ok)
        self.assertIsNone(self.r.resolve("GET", "/api/bar"))

    def test_method_isolation(self):
        self.r.get("/api/foo", _ok)
        # POST against a GET-only route must NOT match.
        self.assertIsNone(self.r.resolve("POST", "/api/foo"))

    def test_param_captured(self):
        self.r.delete("/api/favs/{name}", _ok)
        match = self.r.resolve("DELETE", "/api/favs/Sky%20Sports")
        self.assertIsNotNone(match)
        self.assertEqual(match[1], {"name": "Sky Sports"})

    def test_param_does_not_cross_slash(self):
        """The critical anti-traversal invariant."""
        self.r.delete("/api/favs/{name}", _ok)
        # `..%2Fetc%2Fpasswd` decodes to `../etc/passwd`. The router
        # sees the literal slashes, and {name} must NOT swallow them.
        self.assertIsNone(self.r.resolve("DELETE",
                                         "/api/favs/foo/bar"))

    def test_param_does_not_match_empty(self):
        self.r.delete("/api/favs/{name}", _ok)
        self.assertIsNone(self.r.resolve("DELETE", "/api/favs/"))

    def test_anchored_no_prefix_match(self):
        """A registration of /api/foo must not match /api/foo/extra."""
        self.r.get("/api/foo", _ok)
        self.assertIsNone(self.r.resolve("GET", "/api/foo/extra"))

    def test_anchored_no_suffix_match(self):
        """Likewise /api/foo must not match /api-foo or similar."""
        self.r.get("/api/foo", _ok)
        self.assertIsNone(self.r.resolve("GET", "/Xapi/foo"))
        self.assertIsNone(self.r.resolve("GET", "/api/foo?"))


if __name__ == "__main__":
    unittest.main()
