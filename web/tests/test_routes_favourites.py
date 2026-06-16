"""Tests for /api/favs/* route handlers.

We exercise the route functions directly with synthetic Request +
RouteContext objects — no socket, no http.server. The RouteContext
gets a real :class:`FavStore` backed by a temp sqlite db (in-process
import works fine).
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import tempfile
import unittest

from aceman.context import RouteContext
from aceman.favourites import FavStore
from aceman.http_io import Request
from aceman.routes import favourites as fav_routes


CID_A = "a" * 40
CID_B = "b" * 40


def _req(method, path, body=None, path_params=None):
    return Request(method=method, path=path,
                   body=body or {}, path_params=path_params or {})


class FavRoutesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = FavStore(pathlib.Path(self._tmp.name) / "db.sqlite")
        self.ctx = RouteContext(store=self.store)

    def test_list_empty(self):
        resp = fav_routes.list_favs(_req("GET", "/api/favs"), self.ctx)
        self.assertEqual(resp.status, 200)
        import json
        self.assertEqual(json.loads(resp.body), [])

    def test_disabled_store_returns_404(self):
        ctx = RouteContext(store=None)
        resp = fav_routes.list_favs(_req("GET", "/api/favs"), ctx)
        self.assertEqual(resp.status, 404)

    def test_add_then_list(self):
        resp = fav_routes.add_fav(
            _req("POST", "/api/favs",
                 body={"name": "Sky Sports", "cid": CID_A}),
            self.ctx)
        self.assertEqual(resp.status, 200)
        import json
        rows = json.loads(
            fav_routes.list_favs(_req("GET", "/api/favs"), self.ctx).body)
        self.assertEqual(rows[0]["name"], "Sky Sports")
        self.assertEqual(rows[0]["cid"], CID_A)

    def test_add_validates_name(self):
        resp = fav_routes.add_fav(
            _req("POST", "/api/favs",
                 body={"name": "bad\tname", "cid": CID_A}),
            self.ctx)
        self.assertEqual(resp.status, 400)

    def test_add_validates_cid(self):
        resp = fav_routes.add_fav(
            _req("POST", "/api/favs",
                 body={"name": "ok", "cid": "not40hex"}),
            self.ctx)
        self.assertEqual(resp.status, 400)

    def test_add_uppercase_cid_is_lowered(self):
        # The add route strips + lowercases server-side.
        fav_routes.add_fav(
            _req("POST", "/api/favs",
                 body={"name": "X", "cid": "A" * 40}),
            self.ctx)
        rows = self.store.list()
        self.assertEqual(rows[0]["cid"], "a" * 40)

    def test_add_duplicate_cid_returns_409_with_existing_name(self):
        self.store.add("first", CID_A)
        resp = fav_routes.add_fav(
            _req("POST", "/api/favs",
                 body={"name": "second", "cid": CID_A}),
            self.ctx)
        self.assertEqual(resp.status, 409)
        import json
        body = json.loads(resp.body)
        self.assertEqual(body["existing_name"], "first")

    def test_add_missing_fields_returns_400(self):
        resp = fav_routes.add_fav(
            _req("POST", "/api/favs", body={"name": "X"}),
            self.ctx)
        self.assertEqual(resp.status, 400)

    def test_touch_rejects_bad_cid(self):
        resp = fav_routes.touch_fav(
            _req("POST", "/api/favs/touch", body={"cid": "z" * 40}),
            self.ctx)
        self.assertEqual(resp.status, 400)

    def test_touch_accepts_uppercase(self):
        self.store.add("X", CID_A)
        resp = fav_routes.touch_fav(
            _req("POST", "/api/favs/touch",
                 body={"cid": "A" * 40}),
            self.ctx)
        self.assertEqual(resp.status, 200)

    def test_delete_existing(self):
        self.store.add("X", CID_A)
        resp = fav_routes.delete_fav(
            _req("DELETE", "/api/favs/X", path_params={"name": "X"}),
            self.ctx)
        self.assertEqual(resp.status, 200)

    def test_delete_missing_returns_404(self):
        resp = fav_routes.delete_fav(
            _req("DELETE", "/api/favs/Nope", path_params={"name": "Nope"}),
            self.ctx)
        self.assertEqual(resp.status, 404)

    def test_rename(self):
        self.store.add("Old", CID_A)
        resp = fav_routes.rename_fav(
            _req("PATCH", "/api/favs/Old", body={"name": "New"},
                 path_params={"name": "Old"}),
            self.ctx)
        self.assertEqual(resp.status, 200)
        self.assertEqual(self.store.list()[0]["name"], "New")

    def test_rename_validates_new_name(self):
        self.store.add("Old", CID_A)
        resp = fav_routes.rename_fav(
            _req("PATCH", "/api/favs/Old", body={"name": "bad\tname"},
                 path_params={"name": "Old"}),
            self.ctx)
        self.assertEqual(resp.status, 400)

    def test_rename_missing_source_returns_404(self):
        resp = fav_routes.rename_fav(
            _req("PATCH", "/api/favs/Nope", body={"name": "New"},
                 path_params={"name": "Nope"}),
            self.ctx)
        self.assertEqual(resp.status, 404)


if __name__ == "__main__":
    unittest.main()
