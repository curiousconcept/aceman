"""Tests for the per-connection dispatcher.

The dispatcher gates every action call: it has to reject malformed
input shapes, oversize bodies, unknown actions, and non-object
params before any action handler is reached. We exercise it with a
``socket.socketpair`` so the test is hermetic — no AF_UNIX file, no
broker process, no podman.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import json
import socket
import threading
import unittest
import unittest.mock as mock

from aceman_broker import dispatcher


def _exchange(request: bytes, replacement_actions=None) -> dict:
    """Send `request` to the dispatcher over a socketpair and return
    the parsed JSON reply. ``replacement_actions`` lets a test inject
    its own ACTIONS map without disturbing the real registry."""
    a, b = socket.socketpair()
    try:
        t = threading.Thread(
            target=_serve, args=(a, replacement_actions), daemon=True)
        t.start()
        b.sendall(request)
        # Tiny read budget — replies are well under 4 KiB.
        buf = b""
        while b"\n" not in buf:
            chunk = b.recv(4096)
            if not chunk:
                break
            buf += chunk
        t.join(timeout=1)
        return json.loads(buf.decode("utf-8"))
    finally:
        try: a.close()
        except OSError: pass
        try: b.close()
        except OSError: pass


def _serve(conn, replacement_actions):
    if replacement_actions is not None:
        with mock.patch.object(dispatcher, "ACTIONS", replacement_actions):
            dispatcher.handle(conn)
    else:
        dispatcher.handle(conn)


class RequestShapeTests(unittest.TestCase):
    def test_well_formed_request_dispatches(self):
        fake = {"engine.status": lambda p: {"container": True}}
        rep = _exchange(b'{"action":"engine.status"}\n', fake)
        self.assertTrue(rep["ok"])
        self.assertEqual(rep["result"], {"container": True})

    def test_empty_request_rejected(self):
        rep = _exchange(b"\n")
        self.assertFalse(rep["ok"])
        self.assertIn("empty", rep["error"])

    def test_oversize_request_rejected(self):
        # MAX_REQ_BYTES is 4 KiB; send 6 KiB without a newline.
        rep = _exchange(b"x" * (6 * 1024))
        self.assertFalse(rep["ok"])
        self.assertIn("too large", rep["error"])

    def test_invalid_json_rejected(self):
        rep = _exchange(b"not valid json\n")
        self.assertFalse(rep["ok"])
        self.assertIn("invalid JSON", rep["error"])

    def test_non_object_payload_rejected(self):
        rep = _exchange(b"[1, 2, 3]\n")
        self.assertFalse(rep["ok"])
        self.assertIn("must be a JSON object", rep["error"])

    def test_non_utf8_rejected(self):
        # Starts a 4-byte sequence that's invalid UTF-8.
        rep = _exchange(b"\xff\xfe\n")
        self.assertFalse(rep["ok"])
        self.assertIn("invalid JSON", rep["error"])


class ActionGateTests(unittest.TestCase):
    def test_unknown_action_refused(self):
        rep = _exchange(b'{"action":"does.not.exist"}\n')
        self.assertFalse(rep["ok"])
        self.assertEqual(rep["error"], "unknown action")

    def test_non_string_action_refused(self):
        rep = _exchange(b'{"action": 12345}\n')
        self.assertFalse(rep["ok"])
        self.assertEqual(rep["error"], "unknown action")

    def test_non_object_params_refused(self):
        fake = {"engine.status": lambda p: {}}
        rep = _exchange(
            b'{"action":"engine.status","params":[1,2,3]}\n', fake)
        self.assertFalse(rep["ok"])
        self.assertIn("params must be a JSON object", rep["error"])

    def test_params_default_to_empty_dict(self):
        seen = {}

        def fake_action(p):
            seen["p"] = p
            return {"ok": True}

        rep = _exchange(b'{"action":"engine.status"}\n',
                        {"engine.status": fake_action})
        self.assertTrue(rep["ok"])
        self.assertEqual(seen["p"], {})


class ActionExceptionTests(unittest.TestCase):
    def test_runtime_error_becomes_error_reply(self):
        def boom(p):
            raise RuntimeError("podman bombed")
        rep = _exchange(b'{"action":"engine.status"}\n',
                        {"engine.status": boom})
        self.assertFalse(rep["ok"])
        self.assertIn("podman bombed", rep["error"])

    def test_value_error_becomes_error_reply(self):
        def boom(p):
            raise ValueError("bad port: 99999")
        rep = _exchange(b'{"action":"engine.status"}\n',
                        {"engine.status": boom})
        self.assertFalse(rep["ok"])
        self.assertIn("bad port", rep["error"])

    def test_action_error_strings_sanitised(self):
        # An action that includes ESC + CR in its error string must
        # have those stripped before reaching the wire — otherwise
        # someone tailing journald gets their terminal hijacked.
        def boom(p):
            raise RuntimeError("oops\x1b[31m\rfake-prompt$ ")
        rep = _exchange(b'{"action":"engine.status"}\n',
                        {"engine.status": boom})
        self.assertFalse(rep["ok"])
        self.assertNotIn("\x1b", rep["error"])
        self.assertNotIn("\r", rep["error"])


class RegistryShapeTests(unittest.TestCase):
    """The real ACTIONS registry must contain every documented action.
    A regression that drops one of these is a silent feature outage."""

    def test_all_expected_actions_registered(self):
        expected = {
            "engine.status", "engine.logs", "engine.start",
            "engine.stop", "engine.set_lan", "engine.restart",
            "engine.memory",
            "gpu.status",
            "image.status", "image.install", "image.remove",
            "players.list", "player.stop",
            "browsers.list", "browser.spawn",
            "desktop.status", "desktop.install", "desktop.uninstall",
            "desktop.restore_mimeapps_backup",
            "broker.version", "broker.shutdown", "broker.respawn",
            "restart.preflight", "web.restart", "web.memory",
        }
        self.assertEqual(set(dispatcher.ACTIONS.keys()), expected)

    def test_no_duplicate_registrations(self):
        # build_registry() raises on duplicates — confirm the real
        # one passes (already proved by import succeeding) AND that
        # the guard works.
        from aceman_broker.actions import register
        actions = {"x": lambda p: {}}
        with self.assertRaises(ValueError):
            register(actions, "x", lambda p: {})


if __name__ == "__main__":
    unittest.main()
