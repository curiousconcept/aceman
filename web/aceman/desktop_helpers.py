"""Helpers shared between the web and the broker for desktop-entry
content generation.

Today only ``_desktop_quote_arg`` lives here — quoting one argument
for an Exec= line is fiddly enough that a typo (forgetting to escape
backticks, missing the ``$`` case, etc.) is a code-injection vector;
having one canonical implementation is worth a module. The broker
keeps its own copy of the helper because it has to stay independent
from the web's import surface, but both must agree on the rules.
"""

from __future__ import annotations


def _desktop_quote_arg(s: str) -> str:
    """Quote one argument for a Desktop Entry Exec= line per the
    freedesktop.org spec: wrap in double quotes, escape ``\\``,
    ``"``, backtick, and ``$``.

    These four characters are the only ones the spec calls out as
    special inside double quotes. We don't try to be smart about
    "needs no quoting at all" — always-quoting is safe and the cost
    is one extra char per side, negligible against Exec lines that
    usually run hundreds of bytes.
    """
    inner = (
        s.replace("\\", "\\\\")
         .replace('"', '\\"')
         .replace("`", "\\`")
         .replace("$", "\\$")
    )
    return f'"{inner}"'
