"""xdg-mime / update-desktop-database wrappers.

These are the only places the broker shells out to xdg-* tools.
Both are best-effort — a missing xdg-mime degrades to "we don't
know the current handler", not a hard error.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess

from .desktop_template import DESKTOP_SCHEME_HANDLER


def query_current_scheme_handler() -> "str | None":
    """Return the .desktop filename currently bound to
    x-scheme-handler/acestream, or None if xdg-mime is absent /
    fails / says nothing is bound."""
    if not shutil.which("xdg-mime"):
        return None
    try:
        r = subprocess.run(
            ["xdg-mime", "query", "default", DESKTOP_SCHEME_HANDLER],
            capture_output=True, text=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    return (r.stdout or "").strip() or None


def refresh_desktop_database(applications_dir: pathlib.Path) -> None:
    """Rebuild the mime-info cache so xdg-mime sees our new .desktop's
    ``MimeType=`` line. Without this, install registers the entry but
    the scheme dispatch never sees us. Silently no-ops if
    update-desktop-database is missing."""
    if not shutil.which("update-desktop-database"):
        return
    try:
        subprocess.run(
            ["update-desktop-database", str(applications_dir)],
            capture_output=True, timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
