"""Input validators for broker action parameters and startup env vars.

The broker treats EVERY input as adversarial:

  * env vars at startup — caller controls these, and they end up
    spliced into ``podman`` argv, so a typo or a malicious value here
    is the only way to get a bad string into the command line.
  * action params over the socket — same threat model as web request
    bodies; we validate before any action handler sees them.

Validators raise ``ValueError`` with a short, sanitised message. They
never accept None silently (a ``params.get(...)`` returning None is a
caller bug, not a valid input).
"""

from __future__ import annotations

import re


# Container/image names: docker registry naming rules (slightly
# stricter — no leading dot/dash, no upper-case for portability).
# All patterns use \A and \Z (not ^ and $) because Python's default
# ^/$ anchors match before/after a final newline — so "ace\n" would
# pass a ^...$ pattern, and a malicious env var containing a newline
# would slip through. \A and \Z anchor strictly at string boundaries.
_NAME_RE = re.compile(r"\A[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}\Z")
_IMAGE_RE = re.compile(r"\A[a-zA-Z0-9][a-zA-Z0-9./:_-]{0,127}\Z")
_URL_RE = re.compile(r"\Ahttp://127\.0\.0\.1:\d{1,5}\Z")
_HOST_RE = re.compile(r"\A[A-Za-z0-9._:\[\]-]{1,253}\Z")


def validate_container_name(name: str) -> str:
    """Container / podman name. Refuses anything that wouldn't survive
    a ``podman ps --filter name=...`` round-trip cleanly."""
    if not isinstance(name, str) or not _NAME_RE.match(name):
        raise ValueError(f"invalid container name: {name!r}")
    return name


def validate_image_tag(tag: str) -> str:
    """Image tag. Same charset rules as container names with a wider
    cap for registry/repo/tag separators."""
    if not isinstance(tag, str) or not _IMAGE_RE.match(tag):
        raise ValueError(f"invalid image tag: {tag!r}")
    return tag


def validate_engine_url(url: str) -> str:
    """Engine URL. Locked to ``http://127.0.0.1:<port>`` — any other
    scheme/host/path is refused outright."""
    if not isinstance(url, str) or not _URL_RE.match(url):
        raise ValueError(
            f"engine URL must be http://127.0.0.1:<port>, got {url!r}")
    return url


def validate_host(host) -> str:
    """Desktop-entry Exec= line `--host` argument. The host is later
    quoted by the desktop_helpers module before splicing into Exec=;
    this validator is the FIRST line of defence, refusing anything
    that wouldn't pass freedesktop.org's authority grammar."""
    if not isinstance(host, str) or not _HOST_RE.match(host):
        raise ValueError(f"invalid host: {host!r}")
    return host


def validate_port(port) -> int:
    """TCP port. Booleans are explicitly refused because ``isinstance
    (True, int)`` returns True in Python — a request body
    ``{"port": true}`` would otherwise sneak through as port 1."""
    if (not isinstance(port, int)
            or isinstance(port, bool)
            or not 1 <= port <= 65535):
        raise ValueError(f"invalid port: {port!r}")
    return port


def validate_bool(value, name: str = "value") -> bool:
    """Strict boolean. Refuses ints (``1``/``0``) and bool-ish strings —
    a flag that widens the engine's network exposure must be set by an
    explicit ``true``/``false``, never coerced from a stray ``1`` that
    a buggy caller happened to send."""
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be a boolean, got {value!r}")
    return value


def validate_lines(value, *, minimum: int = 1, maximum: int = 1000,
                   default: int = 200) -> int:
    """Line-count for log-tail actions. Out-of-range / non-int values
    fall back to ``default`` rather than raising, because the UI sends
    these on a poll and a transient bad value shouldn't break the
    panel — a sensible default is friendlier than a 502."""
    if (not isinstance(value, int)
            or isinstance(value, bool)
            or not minimum <= value <= maximum):
        return default
    return value
