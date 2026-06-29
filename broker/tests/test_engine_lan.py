"""Tests for the engine LAN-exposure action.

The flag widens the engine's host bind from loopback to all interfaces,
so the security-critical assertions are: (1) ACE_API_HOST=0.0.0.0 is set
in the launch env ONLY when the operator opted in, and (2) the flag is
ephemeral (module default OFF). Everything is mocked — no podman, no
real socket, no subprocess.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest
import unittest.mock as mock

from aceman_broker.actions import engine


class LanInfoTests(unittest.TestCase):
    def tearDown(self):
        engine._lan_exposed = False

    def test_port_parsed_from_engine_url(self):
        # Default ENGINE_URL is http://127.0.0.1:6878.
        self.assertEqual(engine._lan_port(), 6878)

    def test_default_is_loopback(self):
        # Ephemeral flag must default OFF at import.
        self.assertFalse(engine._lan_exposed)

    def test_lan_info_shape(self):
        engine._lan_exposed = True
        with mock.patch.object(engine, "_detect_lan_ip",
                               return_value="192.168.1.5"):
            info = engine._lan_info()
        self.assertEqual(
            info,
            {"lan_exposed": True, "lan_ip": "192.168.1.5", "lan_port": 6878})


class StartEnvTests(unittest.TestCase):
    """The whole point: the engine only binds 0.0.0.0 when exposed."""

    def tearDown(self):
        engine._lan_exposed = False

    def _captured_launch_env(self) -> dict:
        captured = {}

        def fake_run(cmd, env=None, **kw):
            captured["env"] = env
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.dict("os.environ", {}, clear=True), \
                mock.patch.object(engine, "container_running",
                                  return_value=False), \
                mock.patch.object(engine.subprocess, "run",
                                  side_effect=fake_run), \
                mock.patch.object(engine, "engine_probe", return_value=True):
            engine._start_engine_unlocked()
        return captured["env"]

    def test_loopback_by_default(self):
        engine._lan_exposed = False
        self.assertNotIn("ACE_API_HOST", self._captured_launch_env())

    def test_bind_all_when_exposed(self):
        engine._lan_exposed = True
        self.assertEqual(
            self._captured_launch_env().get("ACE_API_HOST"), "0.0.0.0")


class SetLanTests(unittest.TestCase):
    def tearDown(self):
        engine._lan_exposed = False

    def test_rejects_non_bool(self):
        # "1"/"true" must not coerce — widening exposure needs an
        # explicit boolean.
        for bad in ("true", 1, None):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    engine.action_engine_set_lan({"enabled": bad})

    def test_enable_when_not_running_sets_flag_only(self):
        with mock.patch.object(engine, "container_running",
                               return_value=False), \
                mock.patch.object(engine, "_detect_lan_ip", return_value=""):
            r = engine.action_engine_set_lan({"enabled": True})
        self.assertTrue(engine._lan_exposed)
        self.assertTrue(r["lan_exposed"])
        self.assertFalse(r["relaunched"])

    def test_enable_when_running_respawns(self):
        with mock.patch.object(engine, "container_running",
                               return_value=True), \
                mock.patch.object(engine, "_detect_lan_ip", return_value=""), \
                mock.patch.object(engine, "_stop_engine_unlocked") as stop, \
                mock.patch.object(engine, "_start_engine_unlocked") as start:
            r = engine.action_engine_set_lan({"enabled": True})
        stop.assert_called_once()
        start.assert_called_once()
        self.assertTrue(r["relaunched"])

    def test_no_change_does_not_bounce_engine(self):
        # Already off; setting off again must NOT restart a running engine.
        with mock.patch.object(engine, "container_running",
                               return_value=True), \
                mock.patch.object(engine, "_detect_lan_ip", return_value=""), \
                mock.patch.object(engine, "_stop_engine_unlocked") as stop, \
                mock.patch.object(engine, "_start_engine_unlocked") as start:
            r = engine.action_engine_set_lan({"enabled": False})
        stop.assert_not_called()
        start.assert_not_called()
        self.assertFalse(r["relaunched"])


if __name__ == "__main__":
    unittest.main()
