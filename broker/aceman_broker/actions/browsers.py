"""Browser detection actions.

Each row carries an ``argv`` so the web doesn't have to know how to
spawn anything — the broker is the only thing that ever talks to the
host. The frontend uses only ``name`` and ``source`` for the UI;
the launch helper uses ``argv``.
"""

from __future__ import annotations

import platform
import shutil

from ..flatpak import has_flatpak_app
from ..logging_util import _log
from . import register as _register


PLATFORM = platform.system().lower()


_BROWSER_FLATPAK_IDS = {
    "firefox":       "org.mozilla.firefox",
    "brave":         "com.brave.Browser",
    "chromium":      "org.chromium.Chromium",
    "google-chrome": "com.google.Chrome",
}


def _probe_linux_browser_system(name: str, *candidates: str):
    """Single-element list when any candidate is on PATH.

    ``name`` is the user-facing label ("firefox", "brave", …) kept
    stable across distros even when the binary is named differently
    (``brave-browser-stable`` on some, ``brave`` on others)."""
    for bin_name in candidates:
        path = shutil.which(bin_name)
        if path:
            return [{"name": name, "source": "system", "argv": [path]}]
    return []


def _probe_linux_browser_flatpak(name: str):
    app_id = _BROWSER_FLATPAK_IDS.get(name)
    if app_id and has_flatpak_app(app_id):
        return [{"name": name, "source": "flatpak",
                 "argv": ["flatpak", "run", app_id]}]
    return []


def _probe_linux_firefox():
    return (_probe_linux_browser_system("firefox", "firefox")
            + _probe_linux_browser_flatpak("firefox"))


def _probe_linux_brave():
    return (_probe_linux_browser_system("brave",
                                        "brave-browser", "brave",
                                        "brave-browser-stable")
            + _probe_linux_browser_flatpak("brave"))


def _probe_linux_chromium():
    return (_probe_linux_browser_system("chromium",
                                        "chromium-browser", "chromium")
            + _probe_linux_browser_flatpak("chromium"))


def _probe_linux_chrome():
    return (_probe_linux_browser_system("google-chrome",
                                        "google-chrome",
                                        "google-chrome-stable")
            + _probe_linux_browser_flatpak("google-chrome"))


_BROWSER_PROBES = {
    "linux":   [_probe_linux_firefox, _probe_linux_brave,
                _probe_linux_chromium, _probe_linux_chrome],
    "darwin":  [],
    "windows": [],
}


def action_browsers_list(params: "dict | None" = None) -> dict:
    available: "list[dict]" = []
    for probe in _BROWSER_PROBES.get(PLATFORM, []):
        try:
            rows = probe()
        except OSError as e:
            _log("browsers", "probe %s failed: %s", probe.__name__, e)
            continue
        if rows:
            available.extend(rows)
    return {"platform": PLATFORM, "available": available}


def register(actions: dict) -> None:
    _register(actions, "browsers.list", action_browsers_list)
