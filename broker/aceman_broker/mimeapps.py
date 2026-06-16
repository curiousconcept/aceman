"""mimeapps.list maintenance for the acestream:// scheme handler.

The host's ``~/.config/mimeapps.list`` is a freedesktop.org INI file
that maps mime types (and x-scheme-handler/* pseudo-types) to
``.desktop`` files. The broker writes one line — the one pointing at
``aceman.desktop`` — during install, and scrubs it during uninstall
so the user doesn't end up with a "no apps available" dialog on the
next ``acestream://`` click.

Two security-critical properties this module enforces:

  1. **We only ever touch OUR line.** If the user reassigned the
     scheme to some other ``.desktop`` (manually, or via another app),
     we leave it alone. The regex anchors ``acestream`` AND ``aceman
     .desktop`` so we cannot scrub anyone else's handler.
  2. **No shell, no subprocess.** Pure text manipulation against the
     file. The scrub is exposed as a pure function (``scrub_text``)
     so it's testable without a temp directory.
"""

from __future__ import annotations

import re

from .desktop_template import DESKTOP_SCHEME_HANDLER


# The .desktop filename the broker installs. Keeping this in sync
# with the installer is the whole point of locking the regex to it.
DESKTOP_BASENAME = "aceman.desktop"


def _scrub_pattern(basename: str = DESKTOP_BASENAME):
    """Compile a regex that matches lines of the form::

        x-scheme-handler/acestream=<basename>[;]

    …and ONLY those. Lines pointing at a different .desktop don't
    match. We anchor to start/end of line (``^...$``) under
    re.MULTILINE so partial-line matches can't sneak past.
    """
    return re.compile(
        rf"^x-scheme-handler/acestream\s*=\s*{re.escape(basename)};?\s*$",
        re.MULTILINE,
    )


def scrub_text(text: str,
               basename: str = DESKTOP_BASENAME) -> "tuple[str, bool]":
    """Pure-function version of the file scrub. Returns
    ``(new_text, changed)``. Idempotent over already-scrubbed input.

    Collapses any 3+ consecutive blank lines back to 2, so the file
    doesn't grow blank rows on every uninstall — but DOES NOT
    re-flow the rest of the file beyond that.
    """
    pat = _scrub_pattern(basename)
    new_text, n = pat.subn("", text)
    if n == 0:
        return text, False
    new_text = re.sub(r"\n{3,}", "\n\n", new_text)
    return new_text, True


def render_install_entry(basename: str = DESKTOP_BASENAME) -> str:
    """The line the installer writes into mimeapps.list. Exposed so
    tests can confirm what gets written matches what the scrubber
    will later match."""
    return f"{DESKTOP_SCHEME_HANDLER}={basename}\n"
