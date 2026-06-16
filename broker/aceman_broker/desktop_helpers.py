"""Desktop Entry argument quoting.

The freedesktop.org Desktop Entry spec re-parses the ``Exec=`` line
with a shell-ish grammar. Inside double quotes, exactly four
characters are special: ``\\``, ``"``, backtick, ``$``. Forget any
one of them and you get a code-injection vector at scheme-handler
dispatch time (the user clicks an attacker-supplied
``acestream://`` link → xdg-mime calls our Exec= → shell-ish
expansion runs whatever was smuggled into our quoted arg).

The web package keeps a parallel copy under
``web/aceman/desktop_helpers.py`` — both must agree on the rules.
The duplication is intentional: the broker is import-isolated from
the web by design, and a shared module would either need a
non-trivial PYTHONPATH gymnastic or shipping the broker inside the
web container.
"""

from __future__ import annotations


def desktop_quote_arg(s: str) -> str:
    """Quote one argument for a Desktop Entry Exec= line.

    Always double-quoted; backslashes, embedded double quotes,
    backticks, and dollar signs are escaped. No "needs no quoting"
    fast path — always-quoting is safe and the cost is one extra
    char per side.
    """
    inner = (
        s.replace("\\", "\\\\")
         .replace('"', '\\"')
         .replace("`", "\\`")
         .replace("$", "\\$")
    )
    return f'"{inner}"'
