"""Log + string-sanitisation utilities.

Two related concerns live here because they share the same
defence-in-depth lens: anything we hand to the operator (stderr,
journald, a log panel in the UI) or to the user (HTTP error body,
JSON field) might be carrying attacker-controlled codepoints — the
operator's terminal, the user's browser textContent renderer, or the
clipboard machinery could be hijacked by ESC sequences, bidi
overrides, or zero-width spoofing.

``_terminal_safe`` escapes for terminal output (keeps the bytes
visible as ``\\uXXXX`` so the operator can still see what came
through). ``_sanitize_msg`` strips for UI rendering and caps length
because the user can't be expected to read 1 MB of upstream noise.
"""

from __future__ import annotations

import re
import sys
import time

# Codepoints we never want to write directly to a terminal. Any of these
# inside a log line could be interpreted by the operator's terminal —
# ANSI/CSI/OSC cursor manipulation, screen clear, OSC 52 clipboard
# inject, alt-buffer switch, hyperlink injection — or visually reorder
# the line via bidi.
#
# Range breakdown:
#   \x00-\x08         C0 below TAB
#   \x0a-\x1f         LF onward — includes CR (\x0d, line-overwrite)
#                     and ESC (\x1b, ANSI prefix). TAB (\x09) is kept.
#   \x7f-\x9f         DEL + C1 (0x9B can be interpreted as CSI)
#   ‎‏      LRM / RLM (weak bidi marks)
#    -‮     LS/PS + LRE/RLE/PDF/LRO/RLO (strong overrides)
#   ⁠            word joiner (zero-width invisible)
#   ⁦-⁩     LRI/RLI/FSI/PDI bidi isolates
#   ﻿            BOM / ZWNBSP
_TERMINAL_DANGEROUS = re.compile(
    "["
    "\u0000-\u0008\u000a-\u001f\u007f-\u009f"
    "\u200e\u200f"
    "\u2028-\u202e"
    "\u2060"
    "\u2066-\u2069"
    "\ufeff"
    "]"
)


def _terminal_safe(s: str) -> str:
    """Escape codepoints that could hijack a terminal into ``\\uXXXX``
    form. Idempotent over already-printable input; cheap on the hot path.
    """
    return _TERMINAL_DANGEROUS.sub(
        lambda m: f"\\u{ord(m.group()):04x}", s)


# Stripping variant for HTTP error bodies — the browser already renders
# via textContent so we don't need to keep the bytes around; we just
# want them gone before display. Same dangerous set as terminal, plus
# TAB and the zero-width chars (visible-inert in browsers but spoof
# aids).
_DISPLAY_DANGEROUS = re.compile(
    "["
    "\u0000-\u001f\u007f-\u009f"
    "\u200b-\u200f"
    "\u2028-\u202e"
    "\u2060"
    "\u2066-\u2069"
    "\ufeff"
    "]"
)


def _sanitize_msg(s: str) -> str:
    """Strip dangerous codepoints (C0/DEL/C1, bidi overrides + isolates,
    LRM/RLM, line/paragraph separators, BOM, zero-width chars, word
    joiner) from a string that's about to be shown to the user via an
    HTTP error body, and cap at 300 characters."""
    return _DISPLAY_DANGEROUS.sub("", s)[:300]


def _log(tag: str, fmt: str, *args) -> None:
    """Cheap stderr logger with a tag prefix and HH:MM:SS timestamp.

    No third-party logging library — the plain stderr line shows up
    alongside http.server's own access log lines and is easy to grep.
    Output is run through ``_terminal_safe`` so attacker-controlled
    bytes (engine error strings, upstream URLError reasons, request
    paths) can't hijack the operator's terminal."""
    ts = time.strftime("%H:%M:%S")
    try:
        msg = fmt % args
    except (TypeError, ValueError):
        msg = fmt + " " + " ".join(repr(a) for a in args)
    sys.stderr.write(f"[{ts}] {tag}: {_terminal_safe(msg)}\n")
    sys.stderr.flush()
