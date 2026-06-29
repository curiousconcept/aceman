"""Tests for the broker's input validators.

Every action accepts a ``params`` dict; the validators here are the
first line of defence against malformed / hostile values. Bool-vs-int
gets its own test because Python's ``isinstance(True, int)`` is True,
which has bitten several Python web frameworks.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

from aceman_broker.validators import (
    validate_bool,
    validate_container_name,
    validate_engine_url,
    validate_host,
    validate_image_tag,
    validate_lines,
    validate_port,
)


class ContainerNameTests(unittest.TestCase):
    def test_accepts_simple(self):
        for n in ("ace", "ace_v2", "ace-1", "ace.1"):
            with self.subTest(n=n):
                self.assertEqual(validate_container_name(n), n)

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            validate_container_name("")

    def test_rejects_leading_dash(self):
        with self.assertRaises(ValueError):
            validate_container_name("-ace")

    def test_rejects_leading_dot(self):
        with self.assertRaises(ValueError):
            validate_container_name(".ace")

    def test_rejects_slash(self):
        # `/` would let an env var like ACE_NAME=foo/bar reach
        # `podman --filter name=^foo/bar$` and confuse the filter.
        with self.assertRaises(ValueError):
            validate_container_name("foo/bar")

    def test_rejects_shell_metacharacters(self):
        for bad in ("ace;rm", "ace$(whoami)", "ace`id`", "ace|cat",
                    "ace&", "ace\n", "ace\trm"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    validate_container_name(bad)

    def test_rejects_too_long(self):
        with self.assertRaises(ValueError):
            validate_container_name("a" * 64)

    def test_rejects_non_string(self):
        for v in (None, 123, ["ace"], b"ace"):
            with self.subTest(v=v):
                with self.assertRaises(ValueError):
                    validate_container_name(v)


class ImageTagTests(unittest.TestCase):
    def test_accepts_registry_tag(self):
        self.assertEqual(
            validate_image_tag("localhost/acestream:vetted"),
            "localhost/acestream:vetted")

    def test_accepts_registry_with_port(self):
        # Note: : is allowed because tags use it.
        self.assertEqual(
            validate_image_tag("registry.example/ns/acestream:v1"),
            "registry.example/ns/acestream:v1")

    def test_rejects_shell_metacharacters(self):
        for bad in ("acestream;rm", "$ACESTREAM", "tag with space",
                    "tag\nrm"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    validate_image_tag(bad)


class EngineUrlTests(unittest.TestCase):
    def test_accepts_loopback(self):
        self.assertEqual(
            validate_engine_url("http://127.0.0.1:6878"),
            "http://127.0.0.1:6878")

    def test_rejects_https(self):
        # Engine doesn't speak TLS; an https URL is misconfiguration
        # or attempt to make us emit upstream-style requests.
        with self.assertRaises(ValueError):
            validate_engine_url("https://127.0.0.1:6878")

    def test_rejects_non_loopback(self):
        for bad in (
            "http://10.0.0.1:6878",
            "http://0.0.0.0:6878",
            "http://example.com:6878",
            "http://localhost:6878",
        ):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    validate_engine_url(bad)

    def test_rejects_path_appended(self):
        with self.assertRaises(ValueError):
            validate_engine_url("http://127.0.0.1:6878/anything")


class HostTests(unittest.TestCase):
    def test_accepts_loopback_ip(self):
        self.assertEqual(validate_host("127.0.0.1"), "127.0.0.1")

    def test_accepts_plain_hostname(self):
        self.assertEqual(validate_host("aceman.local"), "aceman.local")

    def test_accepts_ipv6_brackets(self):
        # Used in the host header for IPv6 binds.
        self.assertEqual(validate_host("[::1]"), "[::1]")

    def test_rejects_shell_metacharacters(self):
        for bad in ("127.0.0.1; rm", "$HOSTNAME", "host\rnext",
                    "127.0.0.1 && id", "127.0.0.1\nGET / HTTP/1.0"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    validate_host(bad)

    def test_rejects_empty(self):
        with self.assertRaises(ValueError):
            validate_host("")

    def test_rejects_too_long(self):
        with self.assertRaises(ValueError):
            validate_host("a" * 254)

    def test_rejects_non_string(self):
        for v in (None, 1, ["1.2.3.4"]):
            with self.subTest(v=v):
                with self.assertRaises(ValueError):
                    validate_host(v)


class PortTests(unittest.TestCase):
    def test_accepts_in_range(self):
        for p in (1, 80, 6878, 65535):
            with self.subTest(p=p):
                self.assertEqual(validate_port(p), p)

    def test_rejects_out_of_range(self):
        for p in (0, -1, 65536, 999999):
            with self.subTest(p=p):
                with self.assertRaises(ValueError):
                    validate_port(p)

    def test_rejects_bool(self):
        """isinstance(True, int) is True — must be refused explicitly."""
        with self.assertRaises(ValueError):
            validate_port(True)
        with self.assertRaises(ValueError):
            validate_port(False)

    def test_rejects_non_int(self):
        for v in (None, "8080", 8080.0, "80\nGET"):
            with self.subTest(v=v):
                with self.assertRaises(ValueError):
                    validate_port(v)


class LinesTests(unittest.TestCase):
    def test_in_range_passes(self):
        self.assertEqual(validate_lines(50), 50)

    def test_default_on_zero(self):
        # 0 lines is meaningless for a tail; fall back to default.
        self.assertEqual(validate_lines(0), 200)

    def test_default_on_negative(self):
        self.assertEqual(validate_lines(-10), 200)

    def test_default_on_oversize(self):
        # Caps at maximum; out-of-range falls back to default.
        self.assertEqual(validate_lines(100000), 200)

    def test_default_on_string(self):
        self.assertEqual(validate_lines("500"), 200)

    def test_default_on_bool(self):
        self.assertEqual(validate_lines(True), 200)

    def test_default_on_none(self):
        self.assertEqual(validate_lines(None), 200)


class BoolTests(unittest.TestCase):
    def test_accepts_true_false(self):
        self.assertIs(validate_bool(True), True)
        self.assertIs(validate_bool(False), False)

    def test_rejects_int(self):
        # 1/0 must NOT coerce — this flag widens network exposure.
        for v in (1, 0, -1):
            with self.subTest(v=v):
                with self.assertRaises(ValueError):
                    validate_bool(v)

    def test_rejects_boolish_string(self):
        for v in ("true", "false", "1", "", "yes"):
            with self.subTest(v=v):
                with self.assertRaises(ValueError):
                    validate_bool(v)

    def test_rejects_none(self):
        with self.assertRaises(ValueError):
            validate_bool(None)


if __name__ == "__main__":
    unittest.main()
