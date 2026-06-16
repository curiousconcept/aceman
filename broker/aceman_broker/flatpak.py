"""Flatpak app probe used by both the player and browser detection.

One thin wrapper over ``flatpak info``. Kept separate so the player
and browser probes can share it without circular imports.
"""

from __future__ import annotations

import shutil
import subprocess


def has_flatpak_app(app_id: str) -> bool:
    """True iff a flatpak app with this ID is installed for the
    user. False on any error: missing flatpak binary, install in
    another user namespace, etc. Never raises."""
    if not shutil.which("flatpak"):
        return False
    try:
        r = subprocess.run(
            ["flatpak", "info", app_id],
            capture_output=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0
