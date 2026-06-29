"""Tests for POST /api/engine/lan-expose.

Exercises the route directly with a synthetic Request + RouteContext
carrying a fake engine manager — no broker socket. The route's job is
to reject a non-boolean body before the broker is ever called and to
pass a valid flag straight through.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import json
import unittest

from server.context import RouteContext
from server.http_io import Request
from server.routes import engine_routes


class _FakeEngineMgr:
    def __init__(self):
        self.calls = []

    def set_lan(self, *, enabled):
        self.calls.append(enabled)
        return {"relaunched": False, "lan_exposed": enabled,
                "lan_ip": "192.168.1.5", "lan_port": 6878}


def _req(body):
    return Request(method="POST", path="/api/engine/lan-expose",
                   body=body or {}, path_params={})


class LanExposeRouteTests(unittest.TestCase):
    def test_404_when_engine_management_disabled(self):
        resp = engine_routes.engine_lan_expose(
            _req({"enabled": True}), RouteContext(engine_mgr=None))
        self.assertEqual(resp.status, 404)

    def test_rejects_non_bool_before_calling_broker(self):
        mgr = _FakeEngineMgr()
        for bad in ({"enabled": "true"}, {"enabled": 1}, {"enabled": None}, {}):
            with self.subTest(bad=bad):
                resp = engine_routes.engine_lan_expose(
                    _req(bad), RouteContext(engine_mgr=mgr))
                self.assertEqual(resp.status, 400)
        self.assertEqual(mgr.calls, [])

    def test_passes_valid_flag_through(self):
        mgr = _FakeEngineMgr()
        resp = engine_routes.engine_lan_expose(
            _req({"enabled": True}), RouteContext(engine_mgr=mgr))
        self.assertEqual(resp.status, 200)
        self.assertEqual(mgr.calls, [True])
        self.assertEqual(json.loads(resp.body)["lan_exposed"], True)


if __name__ == "__main__":
    unittest.main()
