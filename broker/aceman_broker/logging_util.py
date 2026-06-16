"""Stderr logging with terminal-safety escaping.

We log to stderr only — under systemd or a foreground process, that's
the right channel either way. Every log line goes through ``_safe``
so attacker-controlled bytes (podman error strings, request paths)
can't move the operator's cursor, paint colour, or split a line by
injecting CR/LF.
"""

from __future__ import annotations

import re
import sys


# Slightly narrower than the web-side ``_DISPLAY_DANGEROUS``: we keep
# tabs (operators sometimes paste tab-separated data through logs)
# but drop everything from CR through ESC and from DEL through C1.
_DANGEROUS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")


def _safe(s) -> str:
    """Replace control-byte characters with ``?`` and cap at 1 KiB.
    Idempotent: a logged-then-re-logged string survives untouched."""
    if not isinstance(s, str):
        s = str(s)
    return _DANGEROUS.sub("?", s)[:1024]


def _log(tag: str, fmt: str, *args) -> None:
    try:
        msg = fmt % args if args else fmt
    except (TypeError, ValueError):
        # Refuse to crash on a bad format string — fall back to a
        # rough repr so we still see *something*.
        msg = fmt + " " + " ".join(repr(a) for a in args)
    sys.stderr.write("[broker:%s] %s\n" % (tag, _safe(msg)))
    sys.stderr.flush()
