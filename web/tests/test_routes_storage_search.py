"""Tests for the small read-only routes: /api/storage-mode, /api/search,
/api/players, /api/browsers, /api/config."""

from __future__ import annotations

from . import _setup  # noqa: F401

import json
import unittest
import unittest.mock as mock

from aceman.context import RouteContext
from aceman.http_io import Request
from aceman.routes import (
    browsers as browsers_routes,
    config_routes,
    players as players_routes,
    search as search_routes,
    storage_mode as storage_routes,
)


def _req(method, path, body=None, query=None, path_params=None):
    return Request(method=method, path=path, body=body or {},
                   query=query or {}, path_params=path_params or {})


class StorageModeTests(unittest.TestCase):
    def test_browser_mode_when_no_store(self):
        ctx = RouteContext(engine="http://e:6878", store=None,
                           search_proxy=None)
        resp = storage_routes.get_storage_mode(
            _req("GET", "/api/storage-mode"), ctx)
        body = json.loads(resp.body)
        self.assertEqual(body["mode"], "browser")
        self.assertEqual(body["engine"], "http://e:6878")
        self.assertEqual(body["search_sources"], [])
        self.assertIsNone(body["favorites_path"])

    def test_sqlite_mode_surfaces_db_path(self):
        import pathlib
        ctx = RouteContext(
            engine="http://e:6878",
            store=mock.Mock(),  # truthy
            db_path=pathlib.Path("/tmp/fav.db"),
        )
        body = json.loads(
            storage_routes.get_storage_mode(
                _req("GET", "/api/storage-mode"), ctx).body)
        self.assertEqual(body["mode"], "sqlite")
        self.assertEqual(body["favorites_path"], "/tmp/fav.db")

    def test_search_sources_present_when_enabled(self):
        from aceman.search import SearchProxy
        ctx = RouteContext(engine="http://e", store=None,
                           search_proxy=mock.Mock(spec=SearchProxy))
        body = json.loads(
            storage_routes.get_storage_mode(
                _req("GET", "/api/storage-mode"), ctx).body)
        self.assertEqual(body["search_sources"], [SearchProxy.BASE])


class SearchRouteTests(unittest.TestCase):
    def test_disabled_returns_404(self):
        ctx = RouteContext(search_proxy=None)
        resp = search_routes.search(
            _req("GET", "/api/search", query={"q": "x"}), ctx)
        self.assertEqual(resp.status, 404)

    def test_too_long_returns_400(self):
        sp = mock.Mock()
        ctx = RouteContext(search_proxy=sp)
        resp = search_routes.search(
            _req("GET", "/api/search", query={"q": "x" * 500}), ctx)
        self.assertEqual(resp.status, 400)
        sp.search.assert_not_called()

    def test_passes_query_through(self):
        sp = mock.Mock()
        sp.search.return_value = [{"cid": "a" * 40, "name": "X",
                                   "translated_name": ""}]
        ctx = RouteContext(search_proxy=sp)
        resp = search_routes.search(
            _req("GET", "/api/search", query={"q": "Sky"}), ctx)
        self.assertEqual(resp.status, 200)
        sp.search.assert_called_once_with("Sky")
        self.assertIn("results", json.loads(resp.body))


class PlayersRouteTests(unittest.TestCase):
    def test_disabled_returns_404(self):
        ctx = RouteContext(players_client=None)
        resp = players_routes.list_players(
            _req("GET", "/api/players"), ctx)
        self.assertEqual(resp.status, 404)

    def test_broker_failure_degrades_to_empty_list(self):
        from aceman.engine_client import EngineError
        client = mock.Mock()
        client.list.side_effect = EngineError("no broker")
        ctx = RouteContext(players_client=client)
        resp = players_routes.list_players(
            _req("GET", "/api/players"), ctx)
        # Degrades to 200 + empty list rather than 502 — the UI handles
        # an empty available[] gracefully.
        self.assertEqual(resp.status, 200)
        body = json.loads(resp.body)
        self.assertEqual(body["available"], [])


class BrowsersRouteTests(unittest.TestCase):
    def test_strips_argv_from_response(self):
        client = mock.Mock()
        client.list.return_value = {
            "platform": "linux",
            "available": [{"name": "firefox", "source": "system",
                           "argv": ["/usr/bin/firefox", "--secret-key"]}],
        }
        ctx = RouteContext(browsers_client=client)
        resp = browsers_routes.list_browsers(
            _req("GET", "/api/browsers"), ctx)
        body = json.loads(resp.body)
        self.assertNotIn("argv", body["available"][0])


class ConfigRouteTests(unittest.TestCase):
    def setUp(self):
        import pathlib, tempfile
        from aceman.favourites import Config
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.config = Config(pathlib.Path(self._tmp.name) / "cfg.json")

    def test_get_returns_snapshot(self):
        ctx = RouteContext(config=self.config)
        resp = config_routes.get_config(
            _req("GET", "/api/config"), ctx)
        self.assertEqual(resp.status, 200)
        body = json.loads(resp.body)
        self.assertIn("playback_mode", body)

    def test_disabled_config_returns_404(self):
        ctx = RouteContext(config=None)
        resp = config_routes.patch_config(
            _req("POST", "/api/config",
                 body={"engine_autostart": False}),
            ctx)
        self.assertEqual(resp.status, 404)

    def test_rejects_unknown_key(self):
        ctx = RouteContext(config=self.config)
        resp = config_routes.patch_config(
            _req("POST", "/api/config", body={"evil_field": True}),
            ctx)
        self.assertEqual(resp.status, 400)

    def test_player_must_be_detected(self):
        client = mock.Mock()
        client.list.return_value = {"available": []}
        ctx = RouteContext(config=self.config, players_client=client)
        resp = config_routes.patch_config(
            _req("POST", "/api/config",
                 body={"default_player": "vlc",
                       "default_player_source": "flatpak"}),
            ctx)
        self.assertEqual(resp.status, 400)

    def test_player_matching_pair_accepted(self):
        client = mock.Mock()
        client.list.return_value = {"available": [
            {"name": "vlc", "source": "flatpak"}]}
        ctx = RouteContext(config=self.config, players_client=client)
        resp = config_routes.patch_config(
            _req("POST", "/api/config",
                 body={"default_player": "vlc",
                       "default_player_source": "flatpak"}),
            ctx)
        self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main()
