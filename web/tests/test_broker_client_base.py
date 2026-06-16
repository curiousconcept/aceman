"""Security tests for BrokerClient transport.

Each test plays the role of a hostile broker over a ``socketpair`` —
the client must refuse oversize replies, non-JSON replies, replies
without an ``ok`` field, etc. without leaking sockets or hanging.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import json
import pathlib
import socket
import threading
import unittest
import unittest.mock as mock

from aceman.broker_client import BrokerClient, BrokerError
from aceman.engine_client import EngineError


class CallNotConnectableTests(unittest.TestCase):
    def test_missing_socket_raises_brokererror(self):
        bc = BrokerClient(pathlib.Path("/nonexistent/broker.sock"))
        with self.assertRaises(BrokerError):
            bc.call("any.action")


class SocketServerTestBase(unittest.TestCase):
    """Spin up a unix socket that runs a single-shot response function
    for each connection. Keeps tests free of any networking that
    might escape the sandbox."""

    def setUp(self):
        self._tmp = pathlib.Path("/tmp") / f"acemansock_{id(self)}"
        if self._tmp.exists():
            self._tmp.unlink()
        self._srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._srv.bind(str(self._tmp))
        self._srv.listen(1)
        self._reply = b""
        self._delay = 0.0
        self._t = threading.Thread(target=self._serve, daemon=True)
        self._t.start()
        self.bc = BrokerClient(self._tmp)
        self.addCleanup(self._teardown)

    def _serve(self):
        try:
            conn, _ = self._srv.accept()
        except OSError:
            return
        try:
            # drain request
            conn.recv(4096)
            if self._delay:
                import time
                time.sleep(self._delay)
            if self._reply:
                conn.sendall(self._reply)
        finally:
            try: conn.close()
            except OSError: pass

    def _teardown(self):
        try: self._srv.close()
        except OSError: pass
        try: self._tmp.unlink()
        except OSError: pass


class ReplyShapeTests(SocketServerTestBase):
    def test_well_formed_ok_reply(self):
        self._reply = json.dumps({"ok": True, "result": {"x": 1}}
                                 ).encode("utf-8")
        self.assertEqual(self.bc.call("anything"), {"x": 1})

    def test_ok_false_raises_engineerror_with_message(self):
        self._reply = json.dumps({"ok": False, "error": "no podman"}
                                 ).encode("utf-8")
        with self.assertRaises(EngineError) as ctx:
            self.bc.call("anything")
        self.assertIn("no podman", str(ctx.exception))

    def test_ok_false_strips_control_bytes_from_message(self):
        self._reply = json.dumps(
            {"ok": False, "error": "boom\x1bEVIL"}
        ).encode("utf-8")
        with self.assertRaises(EngineError) as ctx:
            self.bc.call("anything")
        self.assertNotIn("\x1b", str(ctx.exception))

    def test_non_json_reply_raises(self):
        self._reply = b"<html>oops</html>"
        with self.assertRaises(BrokerError):
            self.bc.call("anything")

    def test_non_object_reply_raises(self):
        self._reply = b"[1, 2, 3]"
        with self.assertRaises(BrokerError):
            self.bc.call("anything")

    def test_oversize_reply_raises(self):
        # Larger than MAX_REPLY_BYTES (64 KB). We don't have to send
        # the whole valid blob — first chunk over the cap is enough.
        big = b'{"ok": true, "result": {"data": "' + b"A" * (
            BrokerClient.MAX_REPLY_BYTES + 1024) + b'"}}'
        self._reply = big
        with self.assertRaises(BrokerError) as ctx:
            self.bc.call("anything")
        self.assertIn("too large", str(ctx.exception))

    def test_result_non_dict_returns_empty(self):
        # Defensive: future broker action returning a list shouldn't
        # crash the client; just give the caller an empty dict.
        self._reply = json.dumps({"ok": True, "result": [1, 2, 3]}
                                 ).encode("utf-8")
        self.assertEqual(self.bc.call("anything"), {})


class TimeoutTests(SocketServerTestBase):
    def test_timeout_raises(self):
        self._delay = 0.6
        with self.assertRaises(BrokerError) as ctx:
            self.bc.call("anything", timeout=0.1)
        self.assertIn("timed out", str(ctx.exception))


class ParamsTests(unittest.TestCase):
    """Stand alone (not subclass of SocketServerTestBase) — we need a
    custom server that captures the request, so the auto-spawned
    accept thread would race us."""

    def test_params_are_sent(self):
        sock_path = pathlib.Path("/tmp") / f"acemansock_{id(self)}"
        if sock_path.exists():
            sock_path.unlink()
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(str(sock_path))
        srv.listen(1)
        self.addCleanup(lambda: srv.close())
        self.addCleanup(lambda: sock_path.unlink(missing_ok=True))

        seen = {}

        def serve():
            conn, _ = srv.accept()
            with conn:
                data = b""
                while b"\n" not in data:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                seen["req"] = json.loads(
                    data.decode("utf-8").rstrip("\n"))
                conn.sendall(json.dumps({"ok": True, "result": {}}
                                        ).encode("utf-8"))

        threading.Thread(target=serve, daemon=True).start()
        bc = BrokerClient(sock_path)
        bc.call("desktop.install",
                params={"host": "127.0.0.1", "port": 8770})
        self.assertEqual(seen["req"]["action"], "desktop.install")
        self.assertEqual(seen["req"]["params"]["host"], "127.0.0.1")
        self.assertEqual(seen["req"]["params"]["port"], 8770)


if __name__ == "__main__":
    unittest.main()
