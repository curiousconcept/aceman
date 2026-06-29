"""Server-side per-user config: a tiny JSON-file key/value store.

Holds the handful of preferences the UI saves between sessions
(engine_autostart, default_player, playback_mode, buffer_secs, …). Lives
under ``~/.config/aceman`` alongside the favourites DB so wiping that
directory resets everything together.
"""

from __future__ import annotations

import json
import pathlib
import threading


class Config:
    """Tiny JSON-file key/value store for server-side preferences.

    Writes are atomic via tmp+rename so a crash mid-save can't leave a
    half-written file. Only known keys with matching types are accepted;
    unknown keys raise ``ValueError`` rather than silently expanding the
    schema.
    """

    _ALLOWED = {
        "engine_autostart": bool,
        "default_player": str,
        "default_player_source": str,
        "playback_mode": str,
        "default_browser": str,
        "default_browser_source": str,
        # Buffer slider (seconds). Drives the in-tab pre-roll AND, via the
        # aceman CLI, the external player's network cache (VLC/mpv).
        "buffer_secs": int,
        # Search sources (multi-source search). The proxy is on by
        # default (existing behaviour); engine-local search is opt-in.
        "search_aceproxy": bool,
        "search_engine": bool,
    }

    def __init__(self, path: pathlib.Path):
        self.path = path
        self._lock = threading.Lock()
        self._data: dict = {
            "engine_autostart": True,
            "default_player": "",
            "default_player_source": "",
            "playback_mode": "external",
            "default_browser": "",
            "default_browser_source": "",
            "buffer_secs": 0,
            "search_aceproxy": True,
            "search_engine": False,
        }
        if path.is_file():
            try:
                loaded = json.loads(path.read_text())
                if isinstance(loaded, dict):
                    for k, v in loaded.items():
                        if k in self._ALLOWED and isinstance(v, self._ALLOWED[k]):
                            self._data[k] = v
            except (OSError, json.JSONDecodeError):
                pass  # corrupt file → start from defaults

    def get(self, key: str, default=None):
        with self._lock:
            return self._data.get(key, default)

    def update(self, patch: dict) -> dict:
        """Apply only known keys with matching types. Returns the new
        state."""
        with self._lock:
            for k, v in patch.items():
                if k not in self._ALLOWED:
                    raise ValueError(f"unknown config key: {k}")
                if not isinstance(v, self._ALLOWED[k]):
                    raise ValueError(
                        f"config key {k} must be {self._ALLOWED[k].__name__}")
                self._data[k] = v
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(self._data, indent=2))
            tmp.replace(self.path)
            return dict(self._data)

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._data)
