"""Constants for the aceman_web frontend.

Pulled out of the main module so paths, regexes, and size caps live in one
place and the runtime code stays focused on behaviour. Imported as a flat
namespace by aceman_web.py — no behaviour, no I/O at import time."""

from __future__ import annotations

import os
import pathlib
import re


# ---------- bind / endpoint defaults ---------------------------------------

DEFAULT_ENGINE = "http://127.0.0.1:6878"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_CONTAINER_NAME = os.environ.get("ACE_NAME", "ace")
DEFAULT_IMAGE_TAG = os.environ.get("ACE_IMAGE", "localhost/acestream:vetted")


# ---------- user-data paths -------------------------------------------------

_CFG_DIR = (
    pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config")
    / "aceman"
)
DEFAULT_DB = _CFG_DIR / "favorites.db"
DEFAULT_CONFIG = _CFG_DIR / "config.json"
DEFAULT_DESKTOP_ENTRY = (
    pathlib.Path(os.environ.get("XDG_DATA_HOME")
                 or pathlib.Path.home() / ".local" / "share")
    / "applications" / "aceman.desktop"
)

# Where the aceman-broker (host-side podman allow-list) listens. We
# never spawn the broker — it runs as a systemd --user service. We just
# open this socket and send one JSON line per call. The broker enforces
# 0600 perms on the file; the kernel's $XDG_RUNTIME_DIR (0700) is the
# outer protection.
DEFAULT_BROKER_SOCKET = (
    pathlib.Path(os.environ.get("XDG_RUNTIME_DIR")
                 or f"/run/user/{os.getuid()}")
    / "aceman" / "broker.sock"
)


# ---------- validation regexes ---------------------------------------------

HEX40 = re.compile(r"^[A-Fa-f0-9]{40}$")
CTRL = re.compile(r"[\x00-\x1f\x7f]")

# Favourite names: 1-128 chars. Letters from any script (Cyrillic, CJK, …)
# are fine — names are displayed via textContent and stored in SQLite, so
# we only need to keep out the codepoints that either break our wire
# format or enable display spoofing. Everything in this set is also
# stripped by the broader server-side _DANGEROUS / _DISPLAY_DANGEROUS
# patterns; keeping the lists aligned means a name that survives those
# passes also survives NAME_OK.
#
# Written as \uXXXX escapes (NOT raw glyphs) so the source stays readable
# — the original literal had two stray U+0020 spaces hidden in a row of
# invisible bidi codepoints, which is what made Cyrillic-with-space names
# like "Матч ТВ" fail validation.
#
# Bands:
#   \t          our column separator in the shell favourites file
#   \x00-\x1f   C0 controls + DEL adjacent
#   \x7f-\x9f   DEL + C1 (terminal-escape territory)
#   ​-‏   ZWSP/ZWNJ/ZWJ + LRM/RLM (invisible-char spoofing
#                  e.g. "Sky​Sports" ≠ "SkySports" visually)
#    -‮  line/paragraph separators + bidi overrides
#                  (LRE/RLE/PDF/LRO/RLO — visual reorder)
#   ⁠          word joiner (zero-width invisible)
#   ⁦-⁩  bidi isolates (LRI/RLI/FSI/PDI)
#   ﻿          BOM / ZWNBSP
_NAME_FORBIDDEN = (
    r"\t\x00-\x1f\x7f-\x9f"
    r"\u200b-\u200f"        # ZWSP/ZWNJ/ZWJ + LRM/RLM
    r"\u2028-\u202e"        # LS/PS + LRE/RLE/PDF/LRO/RLO
    r"\u2060"               # word joiner
    r"\u2066-\u2069"        # bidi isolates
    r"\ufeff"               # BOM/ZWNBSP
)
NAME_OK = re.compile(
    rf"^[^{_NAME_FORBIDDEN}][^{_NAME_FORBIDDEN}]{{0,127}}$"
)


# ---------- size caps ------------------------------------------------------

# Plenty for our tiny JSON requests; refuses anything bigger.
MAX_BODY = 16 * 1024
# Mirrors curl --max-filesize 65536 in the shell aceman.
MAX_ENGINE_BYTES = 64 * 1024
