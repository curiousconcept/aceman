"""Security tests for the engine HTTP client.

Engine binary is closed-source and unsigned — full
adversary in the threat model. Every byte coming out of it goes
through these helpers, so every refusal documented in the docstrings
needs a test that proves the refusal actually fires.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import io
import json
import unittest
import unittest.mock as mock
import urllib.error

from aceman.engine_client import (
    EngineError,
    _force_engine,
    _release_engine_session,
    engine_getstream,
)


ENGINE = "http://127.0.0.1:6878"
GOOD_CID = "a" * 40


class _FakeResp:
    def __init__(self, payload, status=200):
        if isinstance(payload, dict):
            payload = json.dumps(payload).encode("utf-8")
        self._buf = io.BytesIO(payload)
        self.status = status

    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self, n=-1): return self._buf.read(n)


def _fake_resp(payload, status: int = 200):
    return _FakeResp(payload, status)


class ForceEngineTests(unittest.TestCase):
    """Whatever scheme + authority the engine claims, we rewrite to
    our own — the engine controls only the path+query. This is the
    only defence against an engine that has been compromised to point
    the player at attacker-controlled hosts."""

    def test_rewrites_authority(self):
        out = _force_engine(ENGINE, "http://evil.example:6878/ace/r/aaaa/bbbb")
        self.assertTrue(out.startswith(ENGINE + "/"))
        self.assertIn("/ace/r/aaaa/bbbb", out)

    def test_refuses_https_scheme(self):
        with self.assertRaises(EngineError):
            _force_engine(ENGINE, "https://127.0.0.1:6878/x")

    def test_refuses_file_scheme(self):
        with self.assertRaises(EngineError):
            _force_engine(ENGINE, "file:///etc/passwd")

    def test_keeps_path_and_query(self):
        out = _force_engine(ENGINE, "http://127.0.0.1:6878/ace/r/x?token=t")
        self.assertEqual(out, ENGINE + "/ace/r/x?token=t")


class EngineGetstreamRefusalsTests(unittest.TestCase):
    """Each test asserts a specific class of malicious / malformed
    engine response is refused with :class:`EngineError`."""

    def test_refuses_bad_cid(self):
        with self.assertRaises(EngineError):
            engine_getstream(ENGINE, "not40hex")

    def test_refuses_short_cid(self):
        with self.assertRaises(EngineError):
            engine_getstream(ENGINE, "a" * 39)

    def test_refuses_non_dict_payload(self):
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(b"[1, 2, 3]")):
            with self.assertRaises(EngineError) as ctx:
                engine_getstream(ENGINE, GOOD_CID)
            self.assertIn("not a JSON object", str(ctx.exception))

    def test_refuses_non_json(self):
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(b"<html>error</html>")):
            with self.assertRaises(EngineError) as ctx:
                engine_getstream(ENGINE, GOOD_CID)
            self.assertIn("not JSON", str(ctx.exception))

    def test_refuses_oversize_response(self):
        from aceman.constants import MAX_ENGINE_BYTES
        big = b'{"x": "' + b"A" * (MAX_ENGINE_BYTES + 50) + b'"}'
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(big)):
            with self.assertRaises(EngineError) as ctx:
                engine_getstream(ENGINE, GOOD_CID)
            self.assertIn("size cap", str(ctx.exception))

    def test_refuses_control_bytes_in_url(self):
        # CR / LF / NUL in a returned URL is either a malformed engine
        # or an attempt at HTTP request smuggling against whatever the
        # player executes next.
        body = json.dumps({"response": {
            "playback_url": "http://1.2.3.4/ace/r\rX",
            "command_url": "http://1.2.3.4/ace/cmd/X",
        }}).encode("utf-8")
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(body)):
            with self.assertRaises(EngineError) as ctx:
                engine_getstream(ENGINE, GOOD_CID)
            self.assertIn("control bytes", str(ctx.exception))

    def test_refuses_missing_playback_url(self):
        body = json.dumps({"response": {"command_url": "http://x/"}}
                          ).encode("utf-8")
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(body)):
            with self.assertRaises(EngineError):
                engine_getstream(ENGINE, GOOD_CID)

    def test_surfaces_engine_error_field(self):
        body = json.dumps({"error": "session in progress"}).encode("utf-8")
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(body)):
            with self.assertRaises(EngineError) as ctx:
                engine_getstream(ENGINE, GOOD_CID)
            self.assertIn("session in progress", str(ctx.exception))

    def test_strips_control_bytes_from_engine_error(self):
        body = json.dumps({"error": "boom\x1b[31m"}).encode("utf-8")
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(body)):
            with self.assertRaises(EngineError) as ctx:
                engine_getstream(ENGINE, GOOD_CID)
            self.assertNotIn("\x1b", str(ctx.exception))

    def test_rewrites_returned_urls(self):
        body = json.dumps({"response": {
            "playback_url": "http://evil.example:6878/ace/r/AAAA",
            "command_url": "http://evil.example:6878/ace/cmd/AAAA",
        }}).encode("utf-8")
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        return_value=_fake_resp(body)):
            pb, cmd = engine_getstream(ENGINE, GOOD_CID)
        self.assertTrue(pb.startswith(ENGINE + "/"))
        self.assertNotIn("evil.example", pb)
        self.assertNotIn("evil.example", cmd)


class ReleaseEngineSessionTests(unittest.TestCase):
    """Teardown path — best-effort, swallows every error class. The
    only invariant is that a network error here does NOT escape
    (otherwise a flaky engine would crash player-stop)."""

    def test_no_url_is_noop(self):
        # Should not raise, should not call urlopen.
        with mock.patch("aceman.engine_client.urllib.request.urlopen") as u:
            _release_engine_session(None)
            _release_engine_session("")
            self.assertFalse(u.called)

    def test_swallows_url_error(self):
        with mock.patch("aceman.engine_client.urllib.request.urlopen",
                        side_effect=urllib.error.URLError("no route")):
            # Must not raise.
            _release_engine_session("http://x/cmd")

    def test_appends_method_stop_when_no_query(self):
        with mock.patch("aceman.engine_client.urllib.request.urlopen") as u:
            u.return_value.__enter__ = lambda self: u.return_value
            u.return_value.__exit__ = lambda *a: False
            u.return_value.read = lambda n: b""
            _release_engine_session("http://x/cmd")
            self.assertIn("?method=stop", u.call_args[0][0])

    def test_appends_method_stop_with_existing_query(self):
        with mock.patch("aceman.engine_client.urllib.request.urlopen") as u:
            u.return_value.__enter__ = lambda self: u.return_value
            u.return_value.__exit__ = lambda *a: False
            u.return_value.read = lambda n: b""
            _release_engine_session("http://x/cmd?cid=AAA")
            self.assertIn("&method=stop", u.call_args[0][0])


if __name__ == "__main__":
    unittest.main()
