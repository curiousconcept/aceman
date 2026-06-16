"""Desktop-entry + mimeapps.list management actions.

The text-generation (Exec= quoting, desktop body, mimeapps scrub) is
in stand-alone modules under the package root — this file glues them
to file I/O and xdg-mime calls.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess

from ..config import PROJECT_ROOT
from ..desktop_template import DESKTOP_SCHEME_HANDLER, render_desktop_entry
from ..logging_util import _log
from ..mimeapps import DESKTOP_BASENAME, scrub_text as _scrub_mimeapps_text
from ..paths import desktop_applications_dir, mimeapps_list_path
from ..scheme_handler import (
    query_current_scheme_handler,
    refresh_desktop_database,
)
from ..validators import validate_host, validate_port
from . import register as _register


DESKTOP_LAUNCHER = PROJECT_ROOT / "aceman_web"


def _desktop_path() -> pathlib.Path:
    return desktop_applications_dir() / DESKTOP_BASENAME


def action_desktop_status(params: "dict | None" = None) -> dict:
    path = _desktop_path()
    return {"installed": path.is_file(), "path": str(path)}


def action_desktop_install(params: "dict | None" = None) -> dict:
    params = params or {}
    host = validate_host(params.get("host"))
    port = validate_port(params.get("port"))
    register_scheme = bool(params.get("register_scheme", True))
    container = bool(params.get("container", False))

    path = _desktop_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = render_desktop_entry(
        str(DESKTOP_LAUNCHER), host, port,
        container=container,
        scheme_handler=DESKTOP_SCHEME_HANDLER,
    )
    tmp = path.with_suffix(".desktop.tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.chmod(0o644)
    tmp.replace(path)
    refresh_desktop_database(path.parent)

    previous_handler: "str | None" = None
    backup_path: "str | None" = None
    if register_scheme:
        previous_handler = query_current_scheme_handler()
        own = path.name
        mimeapps = mimeapps_list_path()
        if previous_handler and previous_handler != own and mimeapps.is_file():
            bk = mimeapps.with_name(mimeapps.name + ".bk")
            if not bk.exists():
                try:
                    shutil.copy2(mimeapps, bk)
                    backup_path = str(bk)
                    _log("desktop", "backed up %s -> %s", mimeapps, bk)
                except OSError as e:
                    _log("desktop", "backup failed: %s", e)
            else:
                backup_path = str(bk)
                _log("desktop", "existing backup kept at %s", bk)
        if shutil.which("xdg-mime"):
            try:
                subprocess.run(
                    ["xdg-mime", "default", own, DESKTOP_SCHEME_HANDLER],
                    capture_output=True, timeout=5,
                )
                _log("desktop", "registered default for %s (previous: %s)",
                     DESKTOP_SCHEME_HANDLER, previous_handler or "<none>")
            except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                _log("desktop", "xdg-mime default failed: %s", e)
    else:
        _log("desktop",
             "scheme registration skipped (launcher-only install)")

    _log("desktop", "installed at %s (scheme=%s)",
         path, "yes" if register_scheme else "no")
    return {
        "installed": path.is_file(),
        "path": str(path),
        "scheme": DESKTOP_SCHEME_HANDLER if register_scheme else None,
        "previous_handler": previous_handler
            if previous_handler and previous_handler != path.name else None,
        "backup": backup_path,
    }


def _scrub_mimeapps_entry() -> bool:
    """Remove the ``x-scheme-handler/acestream=aceman.desktop`` line.
    The text-level scrub lives in ``aceman_broker.mimeapps.scrub_text``
    (unit-tested there); this function handles only file I/O."""
    mimeapps = mimeapps_list_path()
    if not mimeapps.is_file():
        return False
    try:
        text = mimeapps.read_text(encoding="utf-8")
    except OSError:
        return False
    new_text, changed = _scrub_mimeapps_text(text, DESKTOP_BASENAME)
    if not changed:
        return False
    tmp = mimeapps.with_suffix(mimeapps.suffix + ".tmp")
    tmp.write_text(new_text, encoding="utf-8")
    tmp.replace(mimeapps)
    _log("desktop", "scrubbed %s entry from %s",
         DESKTOP_BASENAME, mimeapps)
    return True


def action_desktop_uninstall(params: "dict | None" = None) -> dict:
    path = _desktop_path()
    removed = False
    try:
        path.unlink()
        removed = True
        _log("desktop", "removed %s", path)
    except FileNotFoundError:
        pass
    refresh_desktop_database(path.parent)
    scrubbed = _scrub_mimeapps_entry()
    return {
        "installed": path.is_file(),
        "path": str(path),
        "removed": removed,
        "mimeapps_scrubbed": scrubbed,
    }


def action_desktop_restore_mimeapps_backup(
        params: "dict | None" = None) -> dict:
    """Restore mimeapps.list from its .bk sibling, if present. Used by
    factory reset to put the user's previous acestream:// handler back
    after we uninstall ourselves."""
    mimeapps = mimeapps_list_path()
    bk = mimeapps.with_name(mimeapps.name + ".bk")
    if not bk.is_file():
        return {"restored": False, "reason": "no backup found"}
    shutil.copy2(bk, mimeapps)
    bk.unlink()
    return {"restored": True, "path": str(mimeapps)}


def register(actions: dict) -> None:
    _register(actions, "desktop.status", action_desktop_status)
    _register(actions, "desktop.install", action_desktop_install)
    _register(actions, "desktop.uninstall", action_desktop_uninstall)
    _register(actions,
              "desktop.restore_mimeapps_backup",
              action_desktop_restore_mimeapps_backup)
