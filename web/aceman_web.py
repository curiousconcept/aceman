#!/usr/bin/env python3
"""aceman_web — stdlib-only web frontend for the Ace Stream engine.

Mirrors the aceman shell script: probe the engine, request a stream via
/ace/getstream?id=<40hex>&format=json, validate the response, hand back the
playback URL, and stop the session on demand via command_url.

Favourites live in SQLite when the sqlite3 stdlib module is importable;
otherwise the frontend stores them in browser localStorage. Either way the
backend never accepts engine-controlled bytes into the favourites store —
content IDs are validated to ^[A-Fa-f0-9]{40}$ before any persistence.

Run:
    python3 aceman_web.py
Then open http://127.0.0.1:8765/

No third-party packages. Python 3.9+.
"""

from __future__ import annotations

# Set the kernel-level process comm name so `ps -e`, `top`, `cat
# /proc/PID/comm`, and journald all show "aceman_web" instead of
# "python3". argv[0] is already set by the bash wrapper via `exec -a`.
# Linux-only; quietly no-ops elsewhere. Done before any other import so
# the name shows up even if startup later raises.
try:
    import ctypes as _ctypes
    # 15 = PR_SET_NAME. The kernel caps the comm name at 15 bytes
    # (TASK_COMM_LEN - 1); "aceman_web" (12 chars) fits comfortably.
    _ctypes.CDLL("libc.so.6", use_errno=True).prctl(
        15, b"aceman_web\0", 0, 0, 0)
except OSError:
    pass

import argparse
import errno
import hashlib
import http.server
import json
import os
import signal
import pathlib
import re
import shutil
import socket
import ssl
import subprocess
import sys
import collections
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import sqlite3
    SQLITE_AVAILABLE = True
except ImportError:
    SQLITE_AVAILABLE = False


# ---------- package imports -----------------------------------------------
#
# The runtime code now lives in submodules under web/aceman/. This file
# stays as the HTTP handler + entrypoint (Handler, ThreadingServer,
# main); the rest is imported. Keeps this file focused on routing
# while the supporting classes get their own test surfaces.

from server.constants import (
    DEFAULT_ENGINE,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_DB,
    DEFAULT_CONFIG,
    DEFAULT_BROKER_SOCKET,
    HEX40,
    CTRL,
    NAME_OK,
    MAX_BODY,
    MAX_ENGINE_BYTES,
)
from server.log_util import (
    _DISPLAY_DANGEROUS,
    _TERMINAL_DANGEROUS,
    _log,
    _sanitize_msg,
    _terminal_safe,
)
from server.heartbeat import HeartbeatTracker
from server.engine_client import (
    EngineError,
    _force_engine,
    _release_engine_session,
    engine_getstream,
    engine_probe,
)
from server.broker_client import (
    BrokerClient,
    BrokerError,
    BrowsersBrokerClient,
    DesktopBrokerClient,
    EngineBrokerClient,
    GpuBrokerClient,
    ImageBrokerClient,
    PlayersBrokerClient,
    WebBrokerClient,
)
from server.search import SearchError, _NoRedirectHandler, SearchProxy
from server.config_store import Config
from server.favourites import DuplicateCidError, FavStore
from server.history import HistoryStore
from server.desktop_helpers import _desktop_quote_arg
from server.context import RouteContext
from server.http_io import Request, Response
from server.router import Router
from server.routes import register_all as _register_routes


# ---------- index template assembly ----------------------------------------

# Template, stylesheet and script live in sibling folders so they can be
# edited as plain html/css/js. We inline them into a single response at
# startup (no per-request disk I/O, no extra HTTP roundtrips) by replacing
# two sentinels in the html. A restart picks up edits.
_HERE = pathlib.Path(__file__).resolve().parent

# Project root (one level up from web/) so podman build / dist / launcher
# discovery still resolve after the move.
_PROJECT_ROOT = _HERE.parent


def _strip_module_syntax(src: str) -> str:
    """Remove ES module ``import`` / ``export`` keywords so the file
    can be concatenated into a single classic <script> block.

    The lib modules are written as proper ESM (so Node's test runner
    can load them as-is under ``web/ui/tests/``); the browser still
    receives one inlined IIFE bundle to keep the existing
    "single-template, single-request" page-load shape.

    Handles multi-line imports — once a line starts with ``import ``
    we drop every following line too, until we see one that ends in
    ``;``. Otherwise the trailing ``from '…';`` clause would survive
    into the bundle as an orphan statement (``Unexpected string`` at
    parse time, which is opaque in the browser console).

    The transforms are deliberately tiny: line-leading ``import``
    statements get dropped (single- or multi-line); line-leading
    ``export`` keywords get stripped from their definition. Anything
    more clever would duplicate a real bundler — explicitly out of
    scope (stdlib-only).
    """
    out_lines = []
    inside_import = False
    import_buffer: list[str] = []
    for line in src.splitlines():
        s = line.lstrip()
        if inside_import:
            import_buffer.append(s)
            if line.rstrip().endswith(";"):
                inside_import = False
                _check_no_import_alias(" ".join(import_buffer))
                import_buffer = []
            continue
        if s.startswith("import "):
            if line.rstrip().endswith(";"):
                _check_no_import_alias(s)
            else:
                inside_import = True
                import_buffer.append(s)
            continue
        # Aggregate / re-export lines (`export { x } from './y'`,
        # `export * from './y'`) come from a domain's public index.js.
        # The re-exported symbols are already declared by their source
        # file, which is bundled into the same scope — so the re-export
        # is pure noise in the bundle and would otherwise survive as an
        # orphan `{ x } from '…'` (syntax error). Drop it, multi-line
        # aware, exactly like an import.
        if s.startswith("export {") or s.startswith("export *"):
            if not line.rstrip().endswith(";"):
                inside_import = True
                import_buffer.append(s)
            continue
        if s.startswith("export "):
            line = line.replace("export ", "", 1)
        out_lines.append(line)
    return "\n".join(out_lines)


def _check_no_import_alias(stmt: str) -> None:
    """ESM `import { X as Y }` aliases don't survive the bundler
    because the strip step removes the import statement entirely,
    leaving `Y` undefined in the IIFE. Fail loudly with a useful
    error so future regressions don't ship as silent ReferenceError
    crashes in the browser. Rename the export and import the
    canonical name instead — see the detectBrowserFromNav rename
    for the pattern.
    """
    if re.search(r"\bas\b", stmt):
        raise RuntimeError(
            f"bundler: import alias detected in {stmt!r}. "
            "`import {{ X as Y }}` cannot be preserved by the "
            "concatenating bundler — rename the export instead so "
            "the alias is not needed."
        )


_TOP_LEVEL_DECL_RE = re.compile(
    r"^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)


def _top_level_names(src: str) -> "list[str]":
    """Best-effort enumeration of identifiers introduced at the top
    level of an ES module. The bundler flattens every module into a
    single IIFE, so any name that lands at module scope (whether
    `export`ed or not) becomes a sibling of every other module's
    top-level names. Two modules declaring the same `const X` would
    silently break the inlined script with a SyntaxError at parse
    time — and the operator only finds out when the page crashes.

    This is line-prefix matching, not a real parser; nested blocks
    inside if/for/etc. are naturally skipped because they don't sit
    at the start of a line. Good enough for the project's stdlib-only
    constraint and small enough to keep in this file.
    """
    return _TOP_LEVEL_DECL_RE.findall(src)


def _bundle_js() -> str:
    # The browser gets ONE classic-script IIFE: every module's source is
    # concatenated, import/export keywords stripped, names resolved as
    # siblings in a single scope. ESM only exists for the Node test runner.
    #
    # Order matters because of that flattening:
    #   1. ui/lib/**     — the pure, tested primitives (createApi, parseId, …)
    #   2. ui/shared/**  — technical substrate + generic UI (dom, api,
    #                      dropdown, notice); depends on lib.
    #   3. ui/domains/** — business slices (gpu, image, desktop, …); depend
    #                      on lib + shared, are depended on by main.js.
    #   4. ui/main.js    — the bootstrap: wires the DOM + init IIFE; last.
    # rglob (not glob) so grouped subdirectories under each dir are picked
    # up (lib/playback/, domains/gpu/, …). Within the domains pass, files
    # under a per-domain lib/ subdir sort FIRST (sort key 0) so a domain's
    # business file can reference its own lib at top level — same "libs
    # before consumers" guarantee the central lib_dir gives globally.
    lib_dir = _HERE / "ui" / "lib"
    shared_dir = _HERE / "ui" / "shared"
    domains_dir = _HERE / "ui" / "domains"
    parts: "list[str]" = []
    seen: "dict[str, str]" = {}  # name → first file that declared it

    def _add(src: str, label: str) -> None:
        # Fail loudly on a duplicate top-level identifier before the
        # bundle ever reaches the browser — otherwise the operator sees an
        # opaque "Identifier 'X' has already been declared" in the devtools
        # console and has to bisect. Everything is one scope now, so a name
        # collision between ANY two bundled files is fatal.
        for name in _top_level_names(src):
            prev = seen.get(name)
            if prev is not None:
                raise RuntimeError(
                    f"bundler: duplicate top-level identifier {name!r} "
                    f"declared in both {prev} and {label} — rename one or "
                    f"move the constant inside the function."
                )
            seen[name] = label
        # The relative path in the section header lets a browser stack
        # trace line up with what the developer sees in their editor.
        parts.append(f"// ---- {label} ----")
        parts.append(_strip_module_syntax(src))

    def _domain_order(p):
        rel = p.relative_to(domains_dir)
        return (0 if "lib" in rel.parts else 1, str(rel))

    for base, prefix in ((lib_dir, "lib"), (shared_dir, "shared"), (domains_dir, "domains")):
        files = base.rglob("*.js") if base.exists() else []
        # A domain's vendor/ holds third-party scripts (e.g. mpegts.min.js)
        # that are NOT our ESM source — they're served as standalone
        # <script>s. Keep them out of the concatenated module bundle.
        files = [p for p in files if "vendor" not in p.relative_to(base).parts]
        files = sorted(files, key=_domain_order) if base is domains_dir else sorted(files)
        for p in files:
            _add(p.read_text(encoding="utf-8"), f"{prefix}/{p.relative_to(base)}")
    _add((_HERE / "ui" / "main.js").read_text(encoding="utf-8"), "main.js")
    # Wrap the whole thing in an IIFE so module-scope variables don't
    # leak into window. Mirrors what ESM gives the test runner.
    return "(() => {\n" + "\n".join(parts) + "\n})();"


def _git_commit() -> str:
    # Native-mode fallback: read the working-tree commit straight from git.
    # Container mode has no .git, so the wrapper passes ACEMAN_COMMIT instead
    # (see _build_stamp). Best-effort — any failure yields "".
    try:
        out = subprocess.run(
            ["git", "-C", str(_HERE.parent), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=2,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _git_dirty() -> bool:
    try:
        out = subprocess.run(
            ["git", "-C", str(_HERE.parent), "status", "--porcelain"],
            capture_output=True, text=True, timeout=2,
        )
        return out.returncode == 0 and bool(out.stdout.strip())
    except Exception:
        return False


def _web_source_digest(seed: str) -> str:
    # A fingerprint of EVERYTHING that shapes this web build: the served
    # page (html/css/js, passed in as `seed`) AND the backend Python that
    # runs the server (aceman_web.py + the aceman/ package). A change to
    # either side moves the digest, so a smoke test can confirm it's the
    # freshly-rebuilt version — frontend OR backend edits both show up.
    #
    # tests/ and __pycache__ are excluded (they don't affect runtime).
    h = hashlib.sha256()
    h.update(seed.encode("utf-8"))
    for p in sorted(_HERE.rglob("*.py")):
        parts = p.relative_to(_HERE).parts
        if "__pycache__" in parts or parts[0] == "tests":
            continue
        h.update(str(p.relative_to(_HERE)).encode("utf-8"))
        h.update(p.read_bytes())
    return h.hexdigest()[:8]


def _build_hash(page_source: str) -> str:
    # A fingerprint of the EXACT sources this server was built from, so a
    # smoke test can confirm it's the freshly-rebuilt version without
    # inspecting podman labels. Covers the served page AND the web backend
    # (see _web_source_digest). This is the RELIABLE signal — it's baked
    # into the image at build time and is present in every mode.
    #
    # Kept SEPARATE from the commit on purpose: while the tree is dirty the
    # image carries no aceman.commit label, and the broker can recreate a
    # container without the commit env — so a commit can be absent even on
    # a correct build. Folding them into one string made that look like a
    # different build; two fields keep them honest.
    return _web_source_digest(page_source)


def _commit_label() -> str:
    # The git commit (+ dirty flag) when known. Env wins (the wrapper sets
    # ACEMAN_COMMIT for container mode, which has no .git); git is the
    # native-mode fallback. May be "" — that's fine, the build hash stands
    # on its own.
    commit = os.environ.get("ACEMAN_COMMIT") or _git_commit()
    dirty = os.environ.get("ACEMAN_DIRTY") == "1" or (
        "ACEMAN_DIRTY" not in os.environ and _git_dirty())
    if not commit:
        return "dirty" if dirty else ""
    return commit[:7] + ("-dirty" if dirty else "")


_INCLUDE_RE = re.compile(
    r"^[ \t]*(?:<!--|/\*)@include[ \t]+(\S+?)[ \t]*(?:-->|\*/)[ \t]*\n",
    re.MULTILINE,
)


def _expand_includes(text: str) -> str:
    """Splice per-domain html/css partials into a shell template.

    A line that is exactly ``<!--@include domains/x/y.html-->`` (html) or
    ``/*@include domains/x/y.css*/`` (css) is replaced, in place, by the
    referenced file's bytes (resolved under web/ui/). "In place" matters:
    the partial lands exactly where its block used to live, so DOM order
    and CSS cascade are preserved — the assembled output is byte-identical
    to a single hand-written file. Markers may nest; we loop to a fixed
    point. Each partial owns the styles/markup of one slice, colocated
    with that slice's JS under web/ui/domains/<x>/ (or web/js/shared/).
    """
    base = _HERE / "ui"

    def repl(m: "re.Match") -> str:
        rel = m.group(1)
        path = base / rel
        if not path.is_file():
            raise RuntimeError(f"@include: missing partial {rel!r} ({path})")
        return path.read_text(encoding="utf-8")

    for _ in range(10):  # fixed-point; depth is tiny in practice
        new = _INCLUDE_RE.sub(repl, text)
        if new == text:
            return new
        text = new
    raise RuntimeError("@include: nesting too deep (cycle?)")


def _load_index_template() -> str:
    html = _expand_includes((_HERE / "ui" / "index.html").read_text(encoding="utf-8"))
    css = _expand_includes((_HERE / "ui" / "style.css").read_text(encoding="utf-8"))
    js = _bundle_js()
    # Hash is computed over the assembled sources (pre-injection) so it's
    # deterministic and never includes itself.
    build = _build_hash(html + css + js)
    commit = _commit_label()
    out = (html
           .replace("/*__ACEMAN_CSS_HERE__*/", css)
           .replace("//__ACEMAN_JS_HERE__", js)
           .replace("__ACEMAN_BUILD__", build)
           .replace("__ACEMAN_COMMIT__", commit))
    # Fail loudly if either marker survived — means the html drifted and
    # the page would render without its styles/script.
    for marker in ("/*__ACEMAN_CSS_HERE__*/", "//__ACEMAN_JS_HERE__"):
        if marker in out:
            raise RuntimeError(f"index template missing sentinel: {marker}")
    print(f"aceman-web: serving build {build}"
          + (f" commit {commit}" if commit else ""), file=sys.stderr)
    return out


INDEX_HTML = _load_index_template()



# ---------- HTTP handler ---------------------------------------------------




class Handler(http.server.BaseHTTPRequestHandler):
    # Set on the class by main() before serving.
    engine: str = DEFAULT_ENGINE
    store: FavStore | None = None  # None means browser-storage mode
    history_store: HistoryStore | None = None
    engine_mgr: "EngineBrokerClient | None" = None
    config: "Config | None" = None
    search_proxy: "SearchProxy | None" = None
    desktop_entry: "DesktopBrokerClient | None" = None
    gpu_client: "GpuBrokerClient | None" = None
    _gpu_caps: "dict | None" = None
    image_mgr: "ImageBrokerClient | None" = None
    players_client: "PlayersBrokerClient | None" = None
    browsers_client: "BrowsersBrokerClient | None" = None
    web_client: "WebBrokerClient | None" = None
    config_dir: "pathlib.Path | None" = None
    db_path: "pathlib.Path | None" = None
    config_path: "pathlib.Path | None" = None
    # Reference to the live ThreadingServer so /api/shutdown can call
    # httpd.shutdown() from a daemon thread (it deadlocks if called from
    # the thread running serve_forever()).
    httpd: "ThreadingServer | None" = None
    heartbeat: "HeartbeatTracker" = HeartbeatTracker()

    # Router + DI context built once in main() and shared across all
    # request threads. Each request is routed through this first; if
    # no route matches, the legacy if/elif branches below run. Routes
    # are migrated module-by-module in routes/ — the ones not yet
    # extracted still rely on Handler-class globals and Handler.httpd.
    router: "Router | None" = None
    route_ctx: "RouteContext | None" = None

    # Single-active in-browser playback. The engine enforces one active
    # session globally — a new /ace/getstream invalidates the previous
    # only if no reader is attached, but a *new reader* on top of an
    # active one would split bytes. We mirror that: when a new
    # /api/stream/proxy/<cid> arrives, terminate the previous ffmpeg
    # subprocess (which closes its upstream connection to the engine),
    # THEN call getstream for the new cid, THEN spawn fresh ffmpeg.
    # `_active_proc` is the live `ffmpeg` Popen for the in-flight
    # proxy; `_active_lock` guards the swap.
    _active_proc: "subprocess.Popen | None" = None
    # Engine session command_url that goes with _active_proc. Hit with
    # ?method=stop on teardown so the engine releases the session
    # immediately — without this an external player (VLC/mpv) that
    # follows a browser-mode session gets "session in progress" until
    # the engine's idle timeout fires. Always swapped under _active_lock.
    _active_command_url: "str | None" = None
    _active_lock = threading.Lock()
    # Allow-list of legitimate Host header values, computed at startup
    # from --host/--port. None means "skip the check" (the admin opted
    # into a non-loopback bind, so DNS-rebinding isn't our concern). For
    # loopback binds we accept both 127.0.0.1 and localhost (and the IPv6
    # form), with and without the port suffix, since browsers' Host
    # header normalisation isn't perfectly predictable.
    allowed_hosts: "set[str] | None" = None

    # Pending-play slot for the `acestream://`-link → "play in the
    # tab the user is already looking at" handoff. Filled by
    # POST /api/play-request (typically from a second aceman_web
    # wrapper invocation that the desktop entry spawned), surfaced
    # to the frontend on /api/engine/status, and atomically cleared
    # by the first POST /api/play-request/claim from any open tab.
    # Multiple open tabs race the claim — exactly one wins so the
    # stream plays once.
    _pending_play_cid: str = ""
    _pending_play_ts: float = 0.0
    _pending_play_lock = threading.Lock()

    server_version = "aceman_web/1.0"
    sys_version = ""

    # High-frequency polling endpoints whose 200 OK access lines drown out
    # everything else. We still log them when they error (4xx / 5xx) so a
    # real problem isn't hidden by the silencing.
    _QUIET_PATHS = frozenset({
        "/api/engine/status",
        "/api/engine/image",
        "/api/engine/probe",
        "/api/engine/memory",
        "/api/web/memory",
    })

    def log_request(self, code="-", size="-"):
        # Treat every request as a heartbeat. The frontend's existing
        # /api/engine/status poll (every 4 s) is the steady pulse; any
        # other click hitting an endpoint also counts. When the tab is
        # closed all polling stops, the heartbeat goes stale, and the
        # watcher thread shuts us down.
        Handler.heartbeat.ping()
        try:
            c = int(code)
        except (TypeError, ValueError):
            c = 0
        # parse_request() in BaseHTTPRequestHandler can fail before it
        # sets self.path (e.g. malformed first line carrying ESC bytes),
        # in which case it calls send_error() → send_response() → here.
        # Fall back safely instead of AttributeError.
        path = getattr(self, "path", "").split("?", 1)[0]
        if c < 400 and path in self._QUIET_PATHS:
            return
        super().log_request(code, size)

    # Quieter than the default that prints every request to stderr. Also
    # escapes ANSI/CSI/OSC + bidi codepoints because the default
    # BaseHTTPRequestHandler log format echoes self.requestline (the raw
    # first line of the HTTP request) — attacker-controlled, can carry
    # terminal-hijacking escape sequences. Anyone able to send a request
    # to 127.0.0.1:port (including any local webpage, via a cross-origin
    # GET whose response they can't read but which still lands here) gets
    # a path-byte channel into the operator's terminal otherwise.
    # Endpoints that the UI polls on a tick — their access-log lines
    # would flood the log panel and bury anything actually interesting.
    # We silence them here; everything else still flows through.
    _ACCESS_LOG_MUTE = (
        "/api/logs",            # logs-tab polling (every 2.5 s while open)
        "/api/engine/status",   # engine status poll (every 4 s)
        "/api/engine/memory",   # memory polling (every 8 s while playing)
        "/api/web/memory",      # memory polling (every 8 s while playing)
        "/api/favs/touch",      # bookkeeping write on each Play
        "/api/history",         # history record on each named Play
    )

    def log_message(self, fmt, *args):
        try:
            msg = fmt % args
        except (TypeError, ValueError):
            msg = fmt + " " + " ".join(repr(a) for a in args)
        if any(p in msg for p in self._ACCESS_LOG_MUTE):
            return
        sys.stderr.write("[%s] %s\n"
                         % (self.log_date_time_string(), _terminal_safe(msg)))

    # ---- helpers --------------------------------------------------------

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("request body too large")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError(f"invalid JSON body: {e}") from e
        if not isinstance(data, dict):
            raise ValueError("expected JSON object")
        return data

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        # The page bakes its CSS+JS inline at process startup, so a
        # restart means new HTML — never serve a cached old copy. Without
        # this header Firefox/Chrome happily reuse the previous response
        # body and the user keeps seeing the old UI after Restart.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        # Tight CSP. Self-contained page: only its own inline + 'self'
        # scripts, only same-origin connections back to us. media-src
        # allows 'self' (the /api/stream/proxy endpoint) and blob: (MSE
        # creates blob URLs for the MediaSource the video element binds
        # to — mandatory for mpegts.js in-browser playback).
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'unsafe-inline'; "
            "connect-src 'self'; "
            "img-src 'self' data:; "
            "media-src 'self' blob:; "
            "base-uri 'none'; form-action 'none'",
        )
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status: int, msg: str) -> None:
        self._send_json(status, {"error": msg})

    # ---- static assets --------------------------------------------------

    # Allow-list of static files we ship. Kept as a hard-coded dict so a
    # path-traversal in the URL can't trick us into reading
    # /etc/passwd — `name` is matched against keys only, never used to
    # build a filesystem path.
    _STATIC_FILES = {
        "mpegts.min.js":                          ("application/javascript", "ui/domains/playback/vendor/mpegts.min.js"),
        "qrcode-generator.js":                    ("application/javascript", "ui/domains/playback/vendor/qrcode-generator.js"),
        "favicon.ico":                            ("image/x-icon",  "ui/assets/static/favicon.ico"),
        "curiousconcept-patreon-button-dark.png": ("image/png",     "ui/assets/static/curiousconcept-patreon-button-dark.png"),
    }

    def _handle_static(self, name: str) -> None:
        entry = self._STATIC_FILES.get(name)
        if entry is None:
            return self._error(404, "not found")
        content_type, rel_path = entry
        try:
            data = (_HERE / rel_path).read_bytes()
        except OSError as e:
            _log("static", "read %s failed: %s", rel_path, e)
            return self._error(500, "static asset unavailable")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        # No-store everywhere: this is a localhost single-user app, so
        # browser caching saves nothing and only causes stale-asset
        # confusion after a rebuild. Matches the HTML/JSON policy.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ---- server log tail (read-only, same-origin) ----------------------

    # Cap how much of the log file we read. The on-disk log can grow
    # large over a long session; we only ever care about the recent
    # tail. 256 KiB is enough for ~2000 typical proxy/lifecycle lines
    # while staying cheap to read on every poll.
    _LOG_TAIL_BYTES = 256 * 1024
    _LOG_MAX_LINES = 1000

    @classmethod
    def _resolve_web_log_path(cls) -> "pathlib.Path | None":
        # Mirror the wrapper's choice: $XDG_CACHE_HOME/aceman/web.log,
        # defaulting to ~/.cache/aceman/web.log.
        cache_dir = (
            pathlib.Path(os.environ.get("XDG_CACHE_HOME")
                         or pathlib.Path.home() / ".cache")
            / "aceman"
        )
        return cache_dir / "web.log"

    @classmethod
    def _resolve_log_path(cls, kind: str) -> "pathlib.Path | None":
        """Both web.log and broker.log live next to each other in
        $XDG_CACHE_HOME/aceman/. Returns None for unknown kinds —
        the caller falls back to a not-available response."""
        if kind not in ("web", "broker"):
            return None
        cache_dir = (
            pathlib.Path(os.environ.get("XDG_CACHE_HOME")
                         or pathlib.Path.home() / ".cache")
            / "aceman"
        )
        return cache_dir / f"{kind}.log"

    def _handle_logs(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        try:
            req_lines = int(qs.get("lines", ["200"])[0])
        except (ValueError, TypeError):
            req_lines = 200
        req_lines = max(1, min(req_lines, self._LOG_MAX_LINES))
        kind = (qs.get("kind", ["web"])[0] or "web").lower()
        # Engine logs come from podman, not a file — delegate to broker.
        if kind == "engine":
            if not self.engine_mgr:
                return self._send_json(200, {"path": "podman logs ace",
                    "tail": "", "lines": 0, "size_bytes": 0, "available": False})
            try:
                r = self.engine_mgr.broker.call(
                    "engine.logs", params={"lines": req_lines}, timeout=10)
            except EngineError as e:
                return self._send_json(200, {"path": "podman logs ace",
                    "tail": f"(broker call failed: {e})",
                    "lines": 0, "size_bytes": 0, "available": False})
            return self._send_json(200, r)

        log_path = self._resolve_log_path(kind)
        if log_path is None:
            return self._error(400, "unknown log kind")
        if not log_path.is_file():
            return self._send_json(200, {
                "path": str(log_path) if log_path else None,
                "tail": "",
                "lines": 0,
                "size_bytes": 0,
                "available": False,
            })
        try:
            size = log_path.stat().st_size
            with open(log_path, "rb") as f:
                read = min(size, self._LOG_TAIL_BYTES)
                f.seek(size - read)
                blob = f.read(read)
        except OSError as e:
            _log("logs", "read %s failed: %s", log_path, e)
            return self._error(500, "log read failed")

        text = blob.decode("utf-8", errors="replace")
        # If we read from a partial line at the start, drop it so the
        # output begins on a clean line boundary.
        if read < size:
            text = text.split("\n", 1)[1] if "\n" in text else text
        all_lines = text.splitlines()
        tail = all_lines[-req_lines:]
        self._send_json(200, {
            "path": str(log_path),
            "tail": "\n".join(tail),
            "lines": len(tail),
            "size_bytes": size,
            "available": True,
        })

    # ---- restart (re-exec the wrapper) ---------------------------------

    # Set at startup; True iff this process is running inside a
    # container (podman or docker leave a marker file). Determines
    # whether /api/restart spawns a host wrapper (host mode, today's
    # default) or asks the broker to `podman restart` us (container
    # mode, post-containerisation).
    _running_in_container: bool = False

    @classmethod
    def _detect_container_runtime(cls) -> None:
        # podman drops /run/.containerenv; docker drops /.dockerenv.
        # Either marker means "we're inside a container."
        cls._running_in_container = (
            pathlib.Path("/run/.containerenv").exists()
            or pathlib.Path("/.dockerenv").exists()
        )

    def _handle_restart(self, body: "dict | None" = None) -> None:
        """POST /api/restart — "restart everything that's currently up".

        Accepts ``{"rebuild": bool}`` (default ``false``). When true,
        the broker also runs ensure_*_image before bouncing each
        container and recreates the container if the image label
        moved — i.e. the operator explicitly asked to pick up source
        changes. When false (the default and the modal's default
        state), restart stays as cheap as ``podman restart`` of each
        container and the foreground wrapper that exec'd into
        ``podman run`` survives.

        Host mode: ask the broker to `podman restart` the engine, then
        ask the broker to shut itself down, then spawn a fresh
        `aceman_web` wrapper. The new wrapper sees no broker socket
        and respawns a fresh broker (matching cold launch); it then
        hits the port already in use and calls the existing
        port-collision takeover (POST /api/shutdown stop_engine=false),
        so this process tears down cleanly. Browser sees connection
        close, reloads, lands on the new instance.

        Container mode: we can't spawn anything on the host. Ask the
        broker to restart the engine, then ask the broker to `podman
        restart` our own container. The container exits, podman
        recreates it, the browser reconnects when the new instance
        binds the port. Broker stays up here — restarting it would
        mean restarting the thing we're talking to mid-call.

        Why not os.execv? It would lose the broker auto-spawn the
        wrapper does on startup. Re-running through the wrapper (or
        through podman restart) keeps cold launch and restart paths
        identical.
        """
        if not self.engine_mgr:
            return self._error(500, "broker not configured")
        broker = self.engine_mgr.broker
        rebuild = bool((body or {}).get("rebuild", False))

        if Handler._running_in_container:
            # Order matters here:
            #   1. broker.respawn FIRST so every subsequent broker call
            #      lands on a freshly-loaded broker process with the
            #      latest on-disk code. The respawn is async (returns
            #      after scheduling a 200 ms-delayed execv); we sleep
            #      ~1 s before the next call so the new broker has
            #      time to rebind the socket. If the pre-flight import
            #      check fails inside broker.respawn, it returns
            #      respawned=false with a reason and we just continue
            #      against the OLD broker — better than no restart.
            #   2. player.stop + engine.restart + web.restart in the
            #      old order. The new broker handles them with its
            #      latest engine_ops / restart_helpers code, including
            #      ensure_*_image rebuilds + container recreate.
            try:
                br = broker.call("broker.respawn", timeout=15)
                if br.get("respawned"):
                    # Give the new broker a beat to bind its socket
                    # before we hit it. 1 s comfortably covers the
                    # 200 ms delay + Python startup + socket bind.
                    time.sleep(1.0)
                    _log("restart", "broker respawned; continuing on new broker")
                else:
                    _log("restart", "broker.respawn declined: %s",
                         br.get("reason", "<no reason>"))
            except EngineError as e:
                _log("restart", "broker.respawn call failed (continuing): %s", e)
            try:
                broker.call("player.stop", timeout=8)
            except EngineError as e:
                _log("restart", "player.stop skipped/failed: %s", e)
            try:
                broker.call("engine.restart",
                            params={"rebuild": rebuild}, timeout=180)
            except EngineError as e:
                _log("restart", "engine.restart failed (continuing): %s", e)
            try:
                broker.call("web.restart",
                            params={"rebuild": rebuild}, timeout=180)
            except EngineError as e:
                _log("restart", "broker web.restart failed: %s", e)
                return self._error(500, f"broker restart failed: {e}")
            _log("restart", "asked broker for podman restart of web container (rebuild=%s)", rebuild)
            return self._send_json(202,
                {"restarting": True, "via": "broker", "rebuild": rebuild})

        # Host mode
        wrapper_path = _PROJECT_ROOT / "aceman_web"
        if not wrapper_path.is_file():
            return self._error(500, f"wrapper not found at {wrapper_path}")
        # Acknowledge first so the UI shows feedback before the socket
        # dies — the actual chain happens in a daemon thread that
        # sleeps briefly to let our response flush.
        self._send_json(202, {"restarting": True, "via": "host"})

        def _do_restart():
            time.sleep(0.3)
            # 0. Close any active external player. Without this the
            #    mpv/vlc window outlives the engine bounce, holds a
            #    dead playback URL, and the user has to close it by
            #    hand. Best-effort — a stale pid file or a player
            #    that's already gone returns "stopped:false" which is
            #    fine.
            try:
                broker.call("player.stop", timeout=8)
                _log("restart", "external player stopped")
            except EngineError as e:
                _log("restart", "player.stop skipped/failed: %s", e)
            # 1. Restart engine container if it's running. Best-effort —
            #    failures here shouldn't block the web/broker restart
            #    (the user can hit Start Engine after they reconnect).
            try:
                broker.call("engine.restart",
                            params={"rebuild": rebuild}, timeout=180)
                _log("restart", "engine container restarted (rebuild=%s)", rebuild)
            except EngineError as e:
                _log("restart", "engine.restart skipped/failed: %s", e)
            # 2. Tell the broker to exit. It'll SIGTERM itself, which
            #    closes its socket and (with the unlink-only-if-ours fix)
            #    removes the socket file. The new wrapper then sees the
            #    socket gone and respawns a fresh broker.
            try:
                broker.call("broker.shutdown", timeout=5)
                _log("restart", "broker shutdown requested")
            except EngineError as e:
                _log("restart", "broker.shutdown failed (continuing): %s", e)
            # Give the broker a moment to actually exit and clean up
            # its socket file before the wrapper checks for it.
            for _ in range(20):
                if not pathlib.Path(broker.socket_path).exists():
                    break
                time.sleep(0.1)
            # 3. Spawn the new wrapper. It will (a) respawn the broker,
            #    (b) hit our still-bound port, and (c) non-interactively
            #    take over via --takeover. Without --takeover, an argv
            #    containing --open-browser short-circuits to "just open
            #    the browser at the old instance" and the old web
            #    process never gets replaced — the restart silently
            #    becomes a no-op. We also drop --open-browser + the
            #    positional URL: the user is already looking at the
            #    page they want, so we don't need to spawn another tab.
            child_argv = []
            for a in sys.argv[1:]:
                if a == "--open-browser":
                    continue
                if a == "--takeover":
                    continue  # we'll add exactly one below; avoid dupes
                if a.lower().startswith("acestream://"):
                    continue  # positional URL — irrelevant on restart
                child_argv.append(a)
            child_argv.append("--takeover")
            try:
                subprocess.Popen(
                    [str(wrapper_path)] + child_argv,
                    start_new_session=True,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                _log("restart",
                     "spawned new wrapper with argv=%r", child_argv)
            except (OSError, FileNotFoundError) as e:
                _log("restart", "spawn failed: %s", e)
        threading.Thread(target=_do_restart, daemon=True).start()

    # ---- stream proxy (ffmpeg-driven) -----------------------------------

    # Chunk size for the ffmpeg→browser pipe. 32 KiB is comfortable for
    # ~2 MiB/s streams (about 64 reads/s). Smaller burns syscalls;
    # bigger holds bytes in our kernel buffer longer than the live
    # latency window wants.
    _PROXY_CHUNK = 32 * 1024

    # Soft cap on ffmpeg shutdown time. Longer than this and we SIGKILL
    # rather than block the next request.
    _PROXY_TERM_TIMEOUT = 2.0

    # Set at process startup: whether the local ffmpeg has an H.264
    # decoder. With it (RPM Fusion ffmpeg on Fedora, default ffmpeg on
    # most other distros) we can decode + deinterlace + re-encode,
    # producing clean progressive output that every MSE decoder accepts.
    # Without it (Fedora's ffmpeg-free) we can only remux, which works
    # for clean progressive streams but trips browsers' MSE decoders on
    # interlaced 1080i, edge profiles, etc.
    _ffmpeg_has_h264_decoder: bool = False

    @classmethod
    def _detect_ffmpeg_capabilities(cls) -> None:
        try:
            r = subprocess.run(
                ["ffmpeg", "-hide_banner", "-decoders"],
                capture_output=True, text=True, timeout=5,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return
        # `ffmpeg -decoders` lists one line per decoder; each starts with
        # six flag chars (e.g. "V.....") then a space + the codec name.
        for line in r.stdout.splitlines():
            stripped = line.lstrip()
            # Look for "h264" as a standalone token after the flags.
            if stripped.startswith(("V..", "V.S", "VFS")) and " h264 " in stripped:
                cls._ffmpeg_has_h264_decoder = True
                return

    # Common tail shared by every ffmpeg path.
    _FFMPEG_AUDIO_OUT = ["-c:a", "aac", "-b:a", "128k", "-f", "mpegts", "-"]
    # libx264/nvenc GOP: -sc_threshold and -bf are encoder-private options.
    _FFMPEG_GOP       = ["-g", "50", "-keyint_min", "50", "-sc_threshold", "0", "-bf", "0"]
    # h264_vaapi GOP: drop -sc_threshold (libx264-only; causes a warning with vaapi).
    _FFMPEG_GOP_VAAPI = ["-g", "50", "-keyint_min", "50", "-bf", "0"]

    # FSRCNNX 2x neural upscale shader (mpv GLSL hook format).
    # Baked into the container image by Containerfile.web.
    _FSRCNNX_SHADER = "/usr/local/share/aceman/shaders/FSRCNNX_x2_16-0-4-1.glsl"

    @classmethod
    def _probe_src_dims(cls, url: str) -> "tuple[int,int] | None":
        """ffprobe the first video stream to get width × height.

        Used to prescale-lock dimensions before libplacebo so the Vulkan
        context never needs to reinitialize when corrupt acestream packets
        cause the decoder to briefly emit frames with different dimensions.
        """
        import subprocess as _sp
        try:
            r = _sp.run(
                ["ffprobe", "-v", "quiet",
                 "-analyzeduration", "3000000", "-probesize", "3000000",
                 "-select_streams", "v:0",
                 "-show_entries", "stream=width,height",
                 "-of", "csv=p=0", url],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0 and r.stdout.strip():
                w, h = r.stdout.strip().splitlines()[0].split(",")
                return (int(w) // 2) * 2, (int(h) // 2) * 2
        except Exception:
            pass
        return None

    @classmethod
    def _libplacebo_scale(cls, src_w: "int|None", src_h: "int|None",
                          out_h: int, vaapi_out: bool = False) -> list:
        """Build libplacebo filter nodes for GPU upscaling (Vulkan hw frames).

        vaapi_out=True: ends with hwmap=derive_device=vaapi for zero-copy
        VAAPI encode — Vulkan DMA-buf is shared directly with VAAPI on AMD/Intel.
        vaapi_out=False: ends with hwdownload,format=yuv420p for CPU encode.
        """
        import os as _os
        nodes = []
        if src_w and src_h:
            nodes.append(f"scale={src_w}:{src_h}")
        # Upload to Vulkan (required — auto_scale_0 cannot produce Vulkan frames).
        nodes.append("hwupload")

        use_fsrcnnx = (
            src_w and src_h
            and src_h * 2 == out_h
            and _os.path.exists(cls._FSRCNNX_SHADER)
        )
        if use_fsrcnnx:
            nodes.append(
                f"libplacebo=w={src_w * 2}:h={out_h}"
                f":custom_shader_path={cls._FSRCNNX_SHADER}"
                f":disable_builtin=true"
            )
            _log("proxy", "scale: FSRCNNX_x2 neural shader (%dx%d → %dx%d)",
                 src_w, src_h, src_w * 2, out_h)
        else:
            nodes.append(f"libplacebo=w=-2:h={out_h}:upscaler=ewa_lanczos")
            _log("proxy", "scale: libplacebo ewa_lanczos → %dp%s",
                 out_h, " (FSRCNNX not available)" if not _os.path.exists(cls._FSRCNNX_SHADER) else "")

        if vaapi_out:
            # Zero-copy: map Vulkan DMA-buf to VAAPI surface (same physical GPU).
            nodes.append("hwmap=derive_device=vaapi")
        else:
            nodes.append("hwdownload")
            nodes.append("format=yuv420p")
        return nodes

    @classmethod
    def _ffmpeg_cmd(cls, playback_url: str, gpu: "dict | None" = None) -> list:
        """Dispatch to the appropriate ffmpeg command builder.

        ``gpu`` is parsed from the proxy request's query string:
            {"backend": "nvidia"|"vaapi"|"qsv",
             "encode": bool, "deinterlace": bool, "scale": int|None}

        Safety: if a backend is requested but the capability probe at
        startup found it absent, we log and fall back to CPU so the
        stream still plays rather than failing silently.
        """
        if not gpu:
            cmd = cls._cpu_cmd(playback_url)
        elif gpu.get("backend") == "nvidia":
            if not (cls._gpu_caps or {}).get("nvidia"):
                _log("proxy", "NVIDIA requested but nvidia-smi absent — CPU fallback")
                cmd = cls._cpu_cmd(playback_url)
            else:
                cmd = cls._nvidia_cmd(playback_url, gpu)
        elif gpu.get("backend") in ("vaapi", "qsv"):
            if not (cls._gpu_caps or {}).get("vaapi"):
                _log("proxy", "VA-API requested but device absent — CPU fallback")
                cmd = cls._cpu_cmd(playback_url)
            else:
                cmd = cls._vaapi_cmd(playback_url, gpu)
        else:
            _log("proxy", "unrecognised backend %r — CPU fallback", gpu.get("backend"))
            cmd = cls._cpu_cmd(playback_url)
        cls._log_pipeline(cmd)
        return cmd

    @staticmethod
    def _log_pipeline(cmd: list) -> None:
        vf = "(no filter chain)"
        enc = "copy"
        for i, part in enumerate(cmd):
            if part == "-vf" and i + 1 < len(cmd):
                vf = cmd[i + 1]
            if part == "-c:v" and i + 1 < len(cmd):
                enc = cmd[i + 1]
        hw_devices = [cmd[i + 1] for i, p in enumerate(cmd)
                      if p == "-init_hw_device" and i + 1 < len(cmd)]
        hw_str = "  hw_devices=[%s]" % ", ".join(hw_devices) if hw_devices else ""
        _log("proxy", "ffmpeg pipeline: filters=[%s]  encoder=%s%s", vf, enc, hw_str)

    @classmethod
    def _cpu_cmd(cls, playback_url: str) -> list:
        """CPU path (original behaviour).

        FULL (has H.264 decoder): decode → yadif → libx264 ultrafast.
        REMUX (ffmpeg-free): -c:v copy; works for clean progressive streams.
        Audio is always re-encoded to AAC because MP3-in-fMP4 is refused
        by every browser MSE implementation.
        """
        pre = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            "-fflags", "+nobuffer+discardcorrupt", "-err_detect", "ignore_err",
            "-flush_packets", "1",
            "-i", playback_url,
        ]
        if cls._ffmpeg_has_h264_decoder:
            video = [
                "-vf", "yadif",
                "-c:v", "libx264",
                "-preset", "ultrafast", "-tune", "zerolatency",
                "-pix_fmt", "yuv420p",
            ] + cls._FFMPEG_GOP
        else:
            video = ["-c:v", "copy"]
        return pre + video + cls._FFMPEG_AUDIO_OUT

    _VULKAN_INIT = ["-init_hw_device", "vulkan=vk:0", "-filter_hw_device", "vk"]

    @classmethod
    def _nvidia_cmd(cls, playback_url: str, gpu: dict) -> list:
        """NVIDIA path: software decode → yadif → libplacebo Vulkan upscale
        → h264_nvenc encode (h264_nvenc accepts CPU frames after hwdownload).
        """
        do_enc = gpu.get("encode", False)
        do_dei = gpu.get("deinterlace", False)
        scale_h = gpu.get("scale")

        vulkan = cls._VULKAN_INIT if scale_h else []
        pre = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
        ] + vulkan + [
            "-fflags", "+nobuffer+discardcorrupt", "-err_detect", "ignore_err",
            "-flush_packets", "1",
            "-i", playback_url,
        ]

        filters = []
        if do_dei:
            filters.append("yadif")
        if scale_h:
            src = cls._probe_src_dims(playback_url)
            src_w, src_h = src if src else (None, None)
            filters.extend(cls._libplacebo_scale(src_w, src_h, scale_h))

        if do_enc:
            video = (["-vf", ",".join(filters)] if filters else []) + [
                "-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll",
            ] + cls._FFMPEG_GOP
        else:
            sw = (["-c:v", "libx264", "-preset", "ultrafast",
                   "-tune", "zerolatency", "-pix_fmt", "yuv420p"] + cls._FFMPEG_GOP
                  if cls._ffmpeg_has_h264_decoder else ["-c:v", "copy"])
            video = (["-vf", ",".join(filters)] if filters else []) + sw

        return pre + video + cls._FFMPEG_AUDIO_OUT

    @classmethod
    def _vaapi_cmd(cls, playback_url: str, gpu: dict) -> list:
        """VA-API path.

        With scaling: software decode → yadif → libplacebo Vulkan upscale
        (hwupload→libplacebo→hwdownload) → libx264.  Using VAAPI encode after
        a Vulkan hwdownload would need a second hwupload targeted at the VAAPI
        device; with -filter_hw_device already bound to Vulkan that conflicts,
        so libx264 handles the encode for the scale path.

        Without scaling: software decode → yadif → [format=nv12,hwupload]
        → h264_vaapi (the path that originally worked without stalls).
        """
        do_enc = gpu.get("encode", False)
        do_dei = gpu.get("deinterlace", False)
        scale_h = gpu.get("scale")
        device = ((cls._gpu_caps or {}).get("vaapi") or {}).get(
            "device", "/dev/dri/renderD128")

        filters = []
        if do_dei:
            filters.append("yadif")

        if scale_h:
            src = cls._probe_src_dims(playback_url)
            src_w, src_h = src if src else (None, None)
            if do_enc:
                # VAAPI VPP upscale: all-GPU, no Vulkan.
                # CPU prescale locks dims → format=nv12 → hwupload → scale_vaapi.
                # No -hwaccel vaapi so scale_vaapi only ever receives clean VAAPI
                # surfaces from hwupload (avoids the CPU↔VAAPI mixing stall).
                pre = [
                    "ffmpeg", "-hide_banner", "-loglevel", "warning",
                    "-vaapi_device", device,
                    "-fflags", "+nobuffer+discardcorrupt", "-err_detect", "ignore_err",
                    "-flush_packets", "1",
                    "-i", playback_url,
                ]
                if src_w and src_h:
                    filters.append(f"scale={src_w}:{src_h}")
                    out_w = (src_w * scale_h // src_h // 2) * 2
                    vaapi_scale = f"scale_vaapi=w={out_w}:h={scale_h}"
                else:
                    vaapi_scale = f"scale_vaapi=w=-2:h={scale_h}"
                filters += ["format=nv12", "hwupload", vaapi_scale]
                _log("proxy", "scale: VAAPI VPP → %dp", scale_h)
                video = ["-vf", ",".join(filters), "-c:v", "h264_vaapi"] + cls._FFMPEG_GOP_VAAPI
            else:
                pre = [
                    "ffmpeg", "-hide_banner", "-loglevel", "warning",
                ] + cls._VULKAN_INIT + [
                    "-fflags", "+nobuffer+discardcorrupt", "-err_detect", "ignore_err",
                    "-flush_packets", "1",
                    "-i", playback_url,
                ]
                filters.extend(cls._libplacebo_scale(src_w, src_h, scale_h))
                sw = (["-c:v", "libx264", "-preset", "ultrafast",
                       "-tune", "zerolatency", "-pix_fmt", "yuv420p"] + cls._FFMPEG_GOP
                      if cls._ffmpeg_has_h264_decoder else ["-c:v", "copy"])
                video = ["-vf", ",".join(filters)] + sw
        else:
            pre = [
                "ffmpeg", "-hide_banner", "-loglevel", "warning",
                "-vaapi_device", device,
                "-fflags", "+nobuffer+discardcorrupt", "-err_detect", "ignore_err",
                "-flush_packets", "1",
                "-i", playback_url,
            ]
            if do_enc:
                filters.extend(["format=nv12", "hwupload"])
                video = ["-vf", ",".join(filters), "-c:v", "h264_vaapi"] + cls._FFMPEG_GOP_VAAPI
            else:
                sw = (["-c:v", "libx264", "-preset", "ultrafast",
                       "-tune", "zerolatency", "-pix_fmt", "yuv420p"] + cls._FFMPEG_GOP
                      if cls._ffmpeg_has_h264_decoder else ["-c:v", "copy"])
                video = (["-vf", ",".join(filters)] if filters else []) + sw

        return pre + video + cls._FFMPEG_AUDIO_OUT

    @staticmethod
    def _kill_proc(proc) -> None:
        """SIGTERM → wait → SIGKILL escalation. Used both when a new
        request displaces an old proxy and in the cleanup `finally`."""
        if proc.poll() is not None:
            return
        try:
            proc.terminate()
        except OSError:
            return
        try:
            proc.wait(timeout=Handler._PROXY_TERM_TIMEOUT)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            proc.kill()
            proc.wait(timeout=1.0)
        except (OSError, subprocess.TimeoutExpired):
            pass

    def _handle_stream_proxy(self, tail: str) -> None:
        """GET /api/stream/proxy/<HEX40>

        Spawns ffmpeg as the engine's sole client. ffmpeg pulls the
        playback URL, remuxes video unchanged and re-encodes audio to
        AAC, and writes a clean MPEG-TS to stdout. We pipe that to the
        browser as a same-origin live stream, where mpegts.js demuxes
        it for MSE.

        ffmpeg vs. raw passthrough: the engine's MPEG-TS output works
        for VLC but trips both Firefox's and Chromium's MSE decoders
        (malformed AVCDecoderConfigurationRecord when mpegts.js extracts
        SPS/PPS from the raw stream). Routing through ffmpeg rebuilds
        the elementary streams in a way mpegts.js' transmuxer + MSE
        decoders accept. The same step also handles MP3→AAC.

        Single-active rule: the engine accepts only one reader at a
        time. On every new request we terminate the prior ffmpeg
        process (which closes its connection to the engine), THEN call
        getstream for the new cid, THEN spawn fresh ffmpeg. Order
        matters — the engine must see "no current reader" before the
        new getstream invalidates the previous session slot.
        """
        parts = tail.split("?", 1)
        cid = parts[0].split("/", 1)[0].lower()
        if not HEX40.match(cid):
            return self._error(400, "expected /api/stream/proxy/<40 hex chars>")

        # Parse optional GPU acceleration params appended by the frontend.
        gpu_settings: "dict | None" = None
        if len(parts) > 1:
            qs = urllib.parse.parse_qs(parts[1])
            backend = qs.get("gpu_backend", [""])[0]
            if backend in ("nvidia", "vaapi", "qsv"):
                gpu_settings = {
                    "backend": backend,
                    "encode":      qs.get("gpu_enc",  [""])[0] == "1",
                    "deinterlace": qs.get("gpu_dei",  [""])[0] == "1",
                }
                scale_str = qs.get("gpu_scale", [""])[0]
                if scale_str.isdigit() and int(scale_str) > 0:
                    gpu_settings["scale"] = int(scale_str)
                _log("proxy", "gpu params parsed: %s", gpu_settings)
            elif backend:
                _log("proxy", "unknown gpu_backend %r — ignored, using CPU", backend)

        # Terminate the prior ffmpeg (if any). Its stdout EOFs, its
        # handler thread exits its pipe loop. We do this BEFORE
        # getstream so the engine sees no attached reader when the
        # session slot gets bumped.
        with Handler._active_lock:
            prior = Handler._active_proc
            prior_cmd = Handler._active_command_url
            Handler._active_proc = None
            Handler._active_command_url = None
        if prior is not None:
            Handler._kill_proc(prior)
            _release_engine_session(prior_cmd)

        try:
            playback_url, command_url = engine_getstream(self.engine, cid)
        except EngineError as e:
            _log("proxy", "getstream failed for %s: %s", cid, e)
            return self._error(502, _sanitize_msg(str(e)))

        # Spawn ffmpeg. stderr is piped + drained by a background thread
        # so we can post-mortem on unexpected exits (engine hung up,
        # decoder hiccup, etc.). The drain prevents the OS pipe buffer
        # filling and back-pressuring ffmpeg into a hang.
        cmd = self._ffmpeg_cmd(playback_url, gpu_settings)
        # VA-API: set LIBVA_DRIVER_NAME so libva doesn't have to guess.
        # The broker probes vainfo on the host at startup and returns the
        # driver name (e.g. "radeonsi" for AMD). Without this hint, libva
        # auto-detection can fail inside the container even when the
        # Mesa driver is present.
        ffmpeg_env = None
        if gpu_settings and gpu_settings.get("backend") in ("vaapi", "qsv"):
            driver = ((self._gpu_caps or {}).get("vaapi") or {}).get("driver")
            if driver:
                ffmpeg_env = {
                    **os.environ,
                    "LIBVA_DRIVER_NAME": driver,
                    "MESA_SHADER_CACHE_DIR": "/tmp",
                }
                _log("proxy", "setting LIBVA_DRIVER_NAME=%s for ffmpeg", driver)
        def _drain_ffmpeg_stderr(stream, sink):
            try:
                for raw in iter(stream.readline, b""):
                    if not raw:
                        break
                    sink.append(raw.rstrip().decode("utf-8", errors="replace"))
            except (OSError, ValueError):
                pass

        # Spawn ffmpeg, waiting up to _FFMPEG_STARTUP_SECS for the first
        # byte before committing the HTTP 200.  If it crashes immediately
        # (GPU driver init failure, engine not ready yet) we retry up to
        # _FFMPEG_MAX_RETRIES times with a short pause in between so the
        # acestream engine has time to buffer.  Headers are only sent once
        # we have a live byte — a 503 is still possible if all retries fail.
        _FFMPEG_STARTUP_SECS = 4.0
        _FFMPEG_MAX_RETRIES  = 2
        import select as _select

        proc       = None
        first_chunk = b""
        stderr_tail: "collections.deque[str]" = collections.deque(maxlen=80)

        for attempt in range(1, _FFMPEG_MAX_RETRIES + 2):
            if proc is not None:
                Handler._kill_proc(proc)
                proc = None
            if attempt > 1:
                _log("proxy", "attempt %d/%d: pausing %.1fs for engine to buffer…",
                     attempt, _FFMPEG_MAX_RETRIES + 1, attempt * 1.5)
                time.sleep(attempt * 1.5)

            try:
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    start_new_session=True,
                    env=ffmpeg_env,
                )
            except FileNotFoundError:
                _log("proxy", "ffmpeg not installed — required for in-browser playback")
                return self._error(
                    503,
                    "ffmpeg is not installed on the host. In-browser playback "
                    "requires it for stream remuxing. Install via your package "
                    "manager (e.g. dnf install ffmpeg-free / apt install ffmpeg) "
                    "and retry, or use the external player.")

            attempt_stderr: "collections.deque[str]" = collections.deque(maxlen=80)
            threading.Thread(
                target=_drain_ffmpeg_stderr,
                args=(proc.stderr, attempt_stderr),
                daemon=True,
            ).start()

            # Wait up to _FFMPEG_STARTUP_SECS for the first byte.
            deadline = time.monotonic() + _FFMPEG_STARTUP_SECS
            crashed  = False
            while time.monotonic() < deadline:
                ready, _, _ = _select.select([proc.stdout], [], [], 0.1)
                if ready:
                    first_chunk = proc.stdout.read(self._PROXY_CHUNK) or b""
                    break
                rc = proc.poll()
                if rc is not None and rc != 0:
                    crashed = True
                    _log("proxy",
                         "attempt %d/%d: ffmpeg exited rc=%s with 0 bytes — %s",
                         attempt, _FFMPEG_MAX_RETRIES + 1, rc,
                         "retrying" if attempt <= _FFMPEG_MAX_RETRIES else "giving up")
                    break

            stderr_tail = attempt_stderr
            if first_chunk or not crashed:
                break  # alive (has data, or slow-starting but not crashed)

        if proc is None:
            return self._error(503, "Stream proxy failed to start")

        with Handler._active_lock:
            Handler._active_proc = proc
            Handler._active_command_url = command_url

        # Headers committed only after ffmpeg is confirmed alive.
        self.send_response(200)
        self.send_header("Content-Type", "video/mp2t")
        self.send_header("Cache-Control", "no-store, no-transform")
        self.send_header("X-Acewatch-Live", "1")
        self.send_header("Connection", "close")
        self.end_headers()

        if gpu_settings:
            _log("proxy", "streaming cid=%s (ffmpeg pid=%d, gpu=%s)",
                 cid, proc.pid, gpu_settings)
        else:
            _log("proxy", "streaming cid=%s (ffmpeg pid=%d)", cid, proc.pid)
        # Observability: track how much we've sent and emit a heartbeat
        # every minute, so a stream that quietly degrades (engine peer
        # loss, swarm thinning) shows up in the log before it dies.
        start = time.monotonic()
        bytes_sent = 0
        next_heartbeat = start + 60.0
        end_reason = "unknown"
        try:
            assert proc.stdout is not None
            # Flush the probe chunk that was read before headers were sent.
            if first_chunk:
                try:
                    self.wfile.write(first_chunk)
                    bytes_sent += len(first_chunk)
                except (BrokenPipeError, ConnectionResetError, OSError):
                    end_reason = "browser disconnected at first chunk"
            while True:
                try:
                    chunk = proc.stdout.read(self._PROXY_CHUNK)
                except OSError as e:
                    end_reason = f"upstream read failed: {type(e).__name__}: {e}"
                    break
                if not chunk:
                    # ffmpeg closed stdout. Either it exited (engine
                    # broke, decoder gave up, etc.) or it was bumped by
                    # the next request.
                    rc = proc.poll()
                    if rc is None:
                        # Stdout EOF but proc still running — rare; give
                        # it a beat to finalise so we can capture rc.
                        try:
                            rc = proc.wait(timeout=1.0)
                        except subprocess.TimeoutExpired:
                            rc = None
                    end_reason = (f"ffmpeg stdout EOF (rc={rc})"
                                  if rc is not None
                                  else "ffmpeg stdout EOF (still running)")
                    break
                try:
                    self.wfile.write(chunk)
                    bytes_sent += len(chunk)
                except (BrokenPipeError, ConnectionResetError, OSError) as e:
                    end_reason = f"browser disconnected: {type(e).__name__}"
                    break

                now = time.monotonic()
                if now >= next_heartbeat:
                    elapsed = now - start
                    mb = bytes_sent / 1_000_000
                    rate = mb / elapsed if elapsed > 0 else 0.0
                    _log("proxy",
                         "cid=%s alive: %.1f MB in %.0fs (%.2f MB/s avg)",
                         cid, mb, elapsed, rate)
                    next_heartbeat = now + 60.0
        finally:
            elapsed = time.monotonic() - start
            Handler._kill_proc(proc)
            # By now `proc` has exited (kill_proc waits). poll() gives
            # us the final return code, or the negative signal that
            # killed it.
            rc = proc.poll()
            _log("proxy",
                 "ended cid=%s duration=%.0fs bytes=%d (%.2f MB/s) "
                 "reason='%s' ffmpeg_rc=%s",
                 cid, elapsed, bytes_sent,
                 (bytes_sent / 1_000_000 / elapsed) if elapsed > 0 else 0.0,
                 end_reason, rc)
            # If ffmpeg exited on its own (not because we SIGTERMed it
            # to bump for a new request) and not cleanly, dump its
            # stderr tail. SIGTERM gives rc == -15; that's normal.
            if rc not in (0, -15, None) and stderr_tail:
                tail_text = "\n  ".join(list(stderr_tail))
                _log("proxy", "cid=%s ffmpeg stderr tail (last %d lines):\n  %s",
                     cid, len(stderr_tail), tail_text)
            with Handler._active_lock:
                if Handler._active_proc is proc:
                    Handler._active_proc = None
                    cmd_to_release = Handler._active_command_url
                    Handler._active_command_url = None
                else:
                    cmd_to_release = None
            # Engine session ends explicitly even on natural EOF / client
            # disconnect — the engine wouldn't notice promptly otherwise
            # and the next /ace/getstream (e.g. user switched to VLC)
            # would race the still-open session.
            _release_engine_session(cmd_to_release)

    # ---- cross-site / CSRF gates ----------------------------------------

    def _host_allowed(self) -> bool:
        """DNS-rebinding defense. The Host header is whatever name the
        browser believed it was talking to — if it isn't in our allow-list,
        someone's pointing an attacker-controlled domain at our loopback
        address to read our API as same-origin. Refuse non-matching Hosts."""
        if Handler.allowed_hosts is None:
            return True  # explicit non-loopback bind; skip check
        return self.headers.get("Host", "") in Handler.allowed_hosts

    def _content_type_json(self) -> bool:
        """CSRF defense. Cross-origin POST/DELETE/PATCH with Content-Type
        application/json is *not* in CORS' safelist — the browser issues
        a preflight OPTIONS that we never answer, so the actual request
        never reaches us. CORS-safelisted Content-Types (text/plain,
        form-urlencoded, multipart) DO reach us without preflight, so we
        refuse them explicitly. Effect: legit clients (our app, curl,
        `aceman_web --stop`, _shutdown_other) all send application/json
        and pass; cross-origin attackers can't satisfy this constraint
        without triggering preflight, which we block."""
        ct = (self.headers.get("Content-Type") or "").lower()
        # Strip parameters like '; charset=utf-8'.
        return ct.split(";", 1)[0].strip() == "application/json"

    # Factory reset: tear down every artifact we own — container, image,
    # desktop entry (incl. restoring mimeapps.list backup if present),
    # favourites DB, config.json, and the shell CLI's text favourites file
    # under the same config dir. Each step is independent and best-effort
    # so a missing component never blocks later steps.
    def _factory_reset(self, body: dict) -> None:
        confirm = (body.get("confirm") or "").strip()
        if confirm != "RESET":
            return self._error(400, "missing or wrong confirmation; expected {\"confirm\":\"RESET\"}")
        steps: list[dict] = []

        def step(name: str, fn):
            try:
                fn()
                steps.append({"name": name, "ok": True})
            except FileNotFoundError:
                steps.append({"name": name, "ok": True, "note": "absent"})
            except Exception as e:  # noqa: BLE001 - best effort, report and continue
                steps.append({"name": name, "ok": False, "error": _sanitize_msg(str(e))})

        # 1. stop & remove container, remove image (broker's image.remove
        #    which already stops+rms the container then rmis the image).
        if self.image_mgr:
            step("remove_image_and_container", self.image_mgr.remove)
        else:
            steps.append({"name": "remove_image_and_container", "ok": False,
                          "error": "image manager unavailable"})

        # 2. uninstall desktop entry, then restore mimeapps.list backup if any.
        if self.desktop_entry:
            step("uninstall_desktop_entry", self.desktop_entry.uninstall)
            step("restore_mimeapps_backup",
                 self.desktop_entry.restore_mimeapps_backup)

        # 3. wipe on-disk app state under the config dir.
        for label, p in (
            ("delete_favorites_db", self.db_path),
            ("delete_config_json", self.config_path),
        ):
            if p is not None:
                step(label, lambda pp=p: pp.unlink())

        # 4. shell CLI's text favourites file lives in the same dir.
        if self.config_dir is not None:
            shell_favs = self.config_dir / "favorites"
            step("delete_shell_favorites", lambda: shell_favs.unlink())
            # 5. remove the config dir itself if it's empty after we're done.
            step("remove_empty_config_dir", lambda: self._rmdir_if_empty(self.config_dir))

        # 6. Stop the broker. Last on purpose: every prior step needs the
        #    broker alive (image.remove, desktop.uninstall,
        #    desktop.restore_mimeapps_backup all flow through it). The
        #    broker's _shutdown handler closes its socket and unlinks the
        #    socket file (only if it still belongs to this PID — the fix
        #    we added earlier), so a subsequent `aceman_web` launch
        #    will respawn a fresh one. The web frontend itself stays up
        #    so the user sees the reset report and can shut us down via
        #    Quit on their own terms.
        if self.engine_mgr:
            broker = self.engine_mgr.broker
            step("stop_broker", lambda: broker.call("broker.shutdown", timeout=5))

        # What we deliberately leave alone, so the user knows. Logs are
        # post-mortem material — if a reset was triggered to recover
        # from a misbehaving install, deleting them first would erase
        # the evidence. Cache dir stays for the same reason. The
        # project source tree (this repo) is never our property to
        # touch.
        kept = [
            {"path": str(pathlib.Path.home() / ".cache" / "aceman"),
             "reason": "logs (web.log, broker.log) — useful for post-mortem; "
                       "delete manually if you want them gone"},
            {"path": str(_PROJECT_ROOT),
             "reason": "this project source tree — out of factory-reset scope"},
        ]
        _log("reset", "factory reset complete (%d steps)", len(steps))
        self._send_json(200, {"steps": steps, "kept": kept})

    @staticmethod
    def _rmdir_if_empty(d: pathlib.Path) -> None:
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()

    # ---- routing --------------------------------------------------------

    def _try_router(self, method: str, body: "dict | None" = None) -> bool:
        """Try the router first. Returns True if a route was matched +
        handled (response already written). False means "no match,
        fall through to legacy if/elif".

        The router is the migration vehicle: every route in
        ``aceman/routes/*`` is dispatched here; everything still in
        the legacy chain runs as before. As routes get extracted they
        register themselves and the if/elif branch shrinks.
        """
        if Handler.router is None or Handler.route_ctx is None:
            return False
        split = urllib.parse.urlsplit(self.path)
        match = Handler.router.resolve(method, split.path)
        if match is None:
            return False
        fn, path_params = match
        query = {k: v[0] for k, v in
                 urllib.parse.parse_qs(split.query).items() if v}
        req = Request(
            method=method, path=split.path, query=query,
            body=body or {}, headers=self.headers,
            path_params=path_params,
        )
        try:
            resp: Response = fn(req, Handler.route_ctx)
        except Exception as e:  # noqa: BLE001 — last-resort safety net
            _log("router", "route %s %s raised %s: %s",
                 method, split.path, type(e).__name__, e)
            resp = Response.error(500, "internal error")
        self._write_response(resp)
        return True

    def _write_response(self, resp: Response) -> None:
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.content_type)
        self.send_header("Content-Length", str(len(resp.body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in resp.extra_headers.items():
            self.send_header(k, v)
        self.end_headers()
        if resp.body:
            self.wfile.write(resp.body)

    def do_GET(self):  # noqa: N802 (stdlib name)
        # DNS-rebinding defense applies to GET too — a rebound origin
        # would read our JSON responses just as freely as a same-origin
        # caller. Refuse before we reveal anything.
        if not self._host_allowed():
            return self._error(421, "host header not in allow-list")
        # Router takes precedence; legacy if/elif handles whatever
        # hasn't been migrated yet (static assets, stream proxy, etc.).
        if self._try_router("GET"):
            return
        # Legacy GET branches still handle anything not yet migrated to
        # aceman/routes/* (the router above is the migration vehicle).
        # That's: the index template, /static/, /favicon.ico, the
        # stream proxy, and /api/engine/image's status check.
        path = urllib.parse.urlsplit(self.path).path
        if path == "/" or path == "/index.html":
            self._send_html(INDEX_HTML)
        elif path.startswith("/static/"):
            return self._handle_static(path[len("/static/"):])
        elif path == "/favicon.ico":
            # Browsers request /favicon.ico unconditionally even if the
            # <link rel=icon> already points at /static/favicon.ico.
            return self._handle_static("favicon.ico")
        elif path.startswith("/api/stream/proxy/"):
            return self._handle_stream_proxy(self.path[len("/api/stream/proxy/"):])
        elif path == "/api/engine/image":
            if not self.image_mgr:
                return self._error(404, "image management disabled")
            self._send_json(200, self.image_mgr.status())
        elif path == "/api/restart/preflight":
            # Drives the Restart modal's "new changes detected"
            # warning. The broker queries the image labels + the host
            # HEAD sha and returns rebuild_recommended; the modal
            # paints the warning when true. Defaults to
            # rebuild_recommended=False outside a git repo (broker
            # can't tell), so the warning stays silent on
            # release-tarball deployments.
            if not self.engine_mgr:
                return self._error(404, "broker not configured")
            try:
                self._send_json(
                    200,
                    self.engine_mgr.broker.call("restart.preflight",
                                                timeout=5))
            except EngineError as e:
                return self._error(502, str(e))
        else:
            self._error(404, "not found")

    def do_POST(self):  # noqa: N802
        if not self._host_allowed():
            return self._error(421, "host header not in allow-list")
        if not self._content_type_json():
            # Cross-origin requests can reach us via CORS-safelisted
            # Content-Types (text/plain, form-encoded, multipart). The
            # safelisted types can't carry our JSON API anyway — refuse
            # them up front so attacker-controlled bytes never reach a
            # state-changing endpoint.
            return self._error(415, "content-type must be application/json")
        path = urllib.parse.urlsplit(self.path).path
        try:
            body = self._read_json()
        except ValueError as e:
            return self._error(400, str(e))

        # Router takes precedence; the legacy if/elif below handles
        # POST routes not yet migrated (image build, restart, factory
        # reset, open-in-browser, player/stop, shutdown).
        if self._try_router("POST", body):
            return

        if path == "/api/engine/image":
            if not self.image_mgr:
                return self._error(404, "image management disabled")
            return self._send_json(200, self.image_mgr.install())

        if path == "/api/restart":
            return self._handle_restart(body or {})

        if path == "/api/play-request":
            # Enqueue a "please play this cid" handoff from a second
            # wrapper invocation. The running web's open tab(s) pick
            # this up via /api/engine/status on the next poll and
            # the first to claim wins. Replaces a `xdg-open
            # ?play=...` cycle that always opened a new tab.
            cid_raw = (body or {}).get("cid", "")
            if not isinstance(cid_raw, str) or not HEX40.match(cid_raw):
                return self._error(400, "invalid cid")
            cid = cid_raw.lower()
            with Handler._pending_play_lock:
                Handler._pending_play_cid = cid
                Handler._pending_play_ts = time.monotonic()
            _log("server", "play-request queued cid=%s", cid)
            return self._send_json(200, {"queued": True, "cid": cid})

        if path == "/api/play-request/claim":
            # First tab to call with the matching cid wins. Server
            # atomically clears the slot so subsequent tabs polling
            # /api/engine/status see no pending cid and don't act.
            cid_raw = (body or {}).get("cid", "")
            if not isinstance(cid_raw, str) or not HEX40.match(cid_raw):
                return self._error(400, "invalid cid")
            cid = cid_raw.lower()
            with Handler._pending_play_lock:
                if Handler._pending_play_cid == cid:
                    Handler._pending_play_cid = ""
                    Handler._pending_play_ts = 0.0
                    return self._send_json(200, {"claimed": True})
            return self._send_json(200, {"claimed": False})

        if path == "/api/factory-reset":
            return self._factory_reset(body)

        if path == "/api/open-in-browser":
            # Open the UI again in the user's currently-selected default
            # browser. The point of this endpoint is the "I picked a new
            # browser while sitting in another one — open a window there"
            # flow: the JS calls this after the user confirms, then a
            # tab pops up in the chosen browser.
            #
            # Optional body field ``cid``: when set, the URL becomes
            # ``/?play=<cid>`` so the new window auto-resumes the stream
            # the user was already watching. Without it the new window
            # just lands on the homepage and the user has to press Play
            # again. cid is validated as 40-hex so nothing user-typed
            # leaks into the URL we hand to the browser.
            host_header = self.headers.get("Host") or f"127.0.0.1:{DEFAULT_PORT}"
            cid = (body.get("cid") or "").lower().strip()
            if cid:
                if not re.fullmatch(r"[a-f0-9]{40}", cid):
                    return self._error(400, "cid must be 40 hex characters")
                target_url = f"http://{host_header}/?play={cid}"
            else:
                target_url = f"http://{host_header}/"
            try:
                _open_in_chosen_browser(target_url)
            except OSError as e:
                return self._error(500, f"could not open browser: {e}")
            return self._send_json(200, {"opened": True, "url": target_url})

        if path == "/api/player/stop":
            # Two cleanups, in order:
            #   1. Kill our own in-page proxy (ffmpeg). Without this, the
            #      next launch hits a single-active engine that's still
            #      streaming to our previous /ace/getstream — VLC's
            #      getstream comes back with a "session in use" error.
            #      We block here until ffmpeg is reaped so the engine
            #      has fully released by the time we return.
            #   2. SIGTERM any host-side shell wrapper holding mpv/vlc.
            # Both steps are idempotent; returning {"stopped": false,
            # "reason": …} means "nothing was playing" — UI swallows it.
            with Handler._active_lock:
                proxy_proc = Handler._active_proc
                proxy_cmd = Handler._active_command_url
                Handler._active_proc = None
                Handler._active_command_url = None
            if proxy_proc is not None:
                Handler._kill_proc(proxy_proc)
                # Explicit engine release so the next external player
                # (VLC / mpv) doesn't race the engine's lazy timeout
                # and get a "session in progress" — bug #7.
                _release_engine_session(proxy_cmd)
                # _kill_proc internally waits up to _PROXY_TERM_TIMEOUT
                # for the child to die (then SIGKILLs). After it returns
                # the engine connection is closed and the session is
                # released — VLC's next getstream wins cleanly.
                _log("server", "/api/player/stop: killed in-page proxy")
            if not self.players_client:
                return self._send_json(200, {"stopped": proxy_proc is not None,
                                             "reason": "broker disabled"})
            try:
                broker_result = self.players_client.stop()
            except EngineError as e:
                return self._error(502, f"broker call failed: {e}")
            # Fold the proxy kill into the response so the UI can see
            # *something* was actually stopped even when no wrapper
            # was alive.
            if proxy_proc is not None and not broker_result.get("stopped"):
                broker_result = dict(broker_result, stopped=True,
                                     proxy_stopped=True)
            return self._send_json(200, broker_result)

        if path == "/api/desktop-entry/app":
            if not self.desktop_entry:
                return self._error(404, "desktop entry disabled")
            # Default to claiming the scheme — preserves behaviour for any
            # caller (e.g. curl) that doesn't pass the flag. The UI is
            # explicit about it via the install modal.
            register_scheme = bool(body.get("register_scheme", True))
            try:
                return self._send_json(200,
                    self.desktop_entry.install(register_scheme=register_scheme))
            except EngineError as e:
                return self._error(502, f"broker install failed: {e}")

        if path == "/api/shutdown":
            # Two-stage exit: stop the engine container (default on — this
            # is the explicit Quit path, where the user has asked for
            # everything down), then call httpd.shutdown() from a daemon
            # thread so this response can flush first and so we don't
            # deadlock (shutdown() blocks until serve_forever() returns,
            # and must be called from a different thread). Callers that
            # want a softer exit (port-collision takeover; the idle
            # watcher does its own httpd.shutdown() without coming
            # through here) pass stop_engine=false explicitly.
            stop_engine = bool(body.get("stop_engine", True))
            _log("server", "shutdown requested (stop_engine=%s)", stop_engine)
            engine_stopped = False
            engine_error: "str | None" = None
            # Close any active external player (VLC/mpv) before tearing
            # the server down. Without this the wrapper shell stays
            # alive holding its single-active-session lock, the player
            # window survives the web's exit, and the user has to kill
            # it manually. Only meaningful when stop_engine is set —
            # the soft-restart takeover path keeps the engine (and so
            # the playing session) running on purpose.
            if stop_engine and self.players_client is not None:
                try:
                    self.players_client.stop()
                except EngineError as e:
                    _log("server", "shutdown: player.stop failed: %s", e)
            if stop_engine and self.engine_mgr and self.engine_mgr.container_running():
                try:
                    self.engine_mgr.stop()
                    engine_stopped = True
                except EngineError as e:
                    engine_error = _sanitize_msg(str(e))
                    _log("server", "shutdown: engine stop failed: %s", e)
            # Take the broker down too on an explicit Quit so "Quit"
            # really means everything is off. Without this the host-side
            # broker process survives every Quit/restart cycle and
            # silently runs old code after the user updates the source.
            # Soft-restart takeover (stop_engine=False) leaves the broker
            # alone — /api/restart manages its lifecycle separately.
            if stop_engine and self.engine_mgr is not None:
                try:
                    self.engine_mgr.broker.call("broker.shutdown", timeout=5)
                except EngineError as e:
                    _log("server", "shutdown: broker.shutdown failed: %s", e)
            httpd_ref = Handler.httpd
            def _do_shutdown():  # noqa: E306 - intentional local closure
                time.sleep(0.3)
                if httpd_ref is not None:
                    httpd_ref.shutdown()
            threading.Thread(target=_do_shutdown, daemon=True).start()
            return self._send_json(202, {
                "shutting_down": True,
                "engine_stopped": engine_stopped,
                "engine_error": engine_error,
            })

        self._error(404, "not found")

    def do_DELETE(self):  # noqa: N802
        if not self._host_allowed():
            return self._error(421, "host header not in allow-list")
        # DELETEs in this app never carry a body, but a CSRF attacker
        # could still issue a cross-origin DELETE — apply the same
        # content-type gate to force preflight, just like POST.
        if not self._content_type_json():
            return self._error(415, "content-type must be application/json")
        if self._try_router("DELETE"):
            return
        # Legacy: only the engine-image removal remains here (it shares
        # build state with the image POST route, both still legacy).
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/engine/image":
            if not self.image_mgr:
                return self._error(404, "image management disabled")
            return self._send_json(200, self.image_mgr.remove())
        self._error(404, "not found")

    def do_PATCH(self):  # noqa: N802
        if not self._host_allowed():
            return self._error(421, "host header not in allow-list")
        if not self._content_type_json():
            return self._error(415, "content-type must be application/json")
        try:
            body = self._read_json()
        except ValueError as e:
            return self._error(400, str(e))
        if self._try_router("PATCH", body):
            return
        # No legacy PATCH routes remain — the only PATCH was /api/favs/<name>
        # and that's now in routes/favourites.py.
        self._error(404, "not found")


class ThreadingServer(http.server.ThreadingHTTPServer):
    daemon_threads = True


# ---------- entry point -----------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--engine", default=os.environ.get("ACE_ENGINE", DEFAULT_ENGINE),
                   help=f"engine base URL (default: {DEFAULT_ENGINE})")
    p.add_argument("--host", default=DEFAULT_HOST,
                   help=f"bind host (default: {DEFAULT_HOST})")
    p.add_argument("--port", type=int, default=DEFAULT_PORT,
                   help=f"bind port (default: {DEFAULT_PORT})")
    p.add_argument("--db", default=str(DEFAULT_DB),
                   help=f"sqlite db path (default: {DEFAULT_DB})")
    p.add_argument("--config", default=str(DEFAULT_CONFIG),
                   help=f"server-side config json path (default: {DEFAULT_CONFIG})")
    p.add_argument("--no-sqlite", action="store_true",
                   help="force browser-only storage even if sqlite3 is available")
    # Container name + launcher path are owned by the broker, not the web
    # frontend (they're frozen into the broker's env at service start).
    # The web only needs to know how to reach the broker.
    p.add_argument("--broker-socket", default=str(DEFAULT_BROKER_SOCKET),
                   help=f"aceman-broker unix socket (default: {DEFAULT_BROKER_SOCKET})")
    p.add_argument("--no-search", action="store_true",
                   help="disable the search-ace.stream proxy endpoint")
    p.add_argument("--open-browser", action="store_true",
                   help="open the UI in the default browser after the server starts "
                        "(used by the installed .desktop launcher)")
    p.add_argument("--takeover", action="store_true",
                   help="if the port is already held by another aceman_web, "
                        "non-interactively shut it down (stop_engine=false) and "
                        "take over. Used by /api/restart's wrapper respawn so "
                        "the new code actually replaces the old.")
    p.add_argument("--idle-timeout", type=int, default=60,
                   help="seconds without a frontend request before auto-shutdown "
                        "(stops the engine container too). 0 disables. Only "
                        "fires after the first request, so a no-browser launch "
                        "stays up. Default: 60.")
    p.add_argument("--wsl", action="store_true",
                   default=os.environ.get("ACE_WSL") == "1",
                   help="WSL mode: the page is served to a Windows-side browser "
                        "across the WSL guest IP. Implies --no-local-desktop. The "
                        "aceman_web shell wrapper sets this automatically when it "
                        "detects WSL.")
    p.add_argument("--no-local-desktop", action="store_true",
                   default=os.environ.get("ACE_NO_LOCAL_DESKTOP") == "1",
                   help="No usable local desktop here: hide the App-launcher "
                        "card and the acestream:// scheme-handler buttons, which "
                        "only act on a Linux desktop at THIS machine. Set when "
                        "the page is served to a browser on another host — a WSL "
                        "or Lima guest, or a remote server. --wsl implies this; "
                        "the macOS (Lima) kit passes it explicitly.")
    p.add_argument("url", nargs="?", default=None,
                   help="optional acestream://<cid> URL to autoplay. Passed by "
                        "the desktop entry's xdg-mime dispatch when the user "
                        "clicks an acestream:// link in 'browser' playback mode. "
                        "Translated into ?play=<cid> on browser_url so the JS "
                        "can pick it up after the page loads.")
    args = p.parse_args(argv)

    # Sanity-check the engine URL the same way aceman does.
    if not re.match(r"^http://[A-Za-z0-9._-]+(:[0-9]+)?$", args.engine):
        print(f"engine URL must look like http://host[:port], got: {args.engine}",
              file=sys.stderr)
        return 2

    Handler.engine = args.engine.rstrip("/")
    Handler.allowed_hosts = _build_allowed_hosts(args.host, args.port)
    if args.no_sqlite or not SQLITE_AVAILABLE:
        Handler.store = None
        mode_msg = "browser localStorage (sqlite3 unavailable)" \
            if not SQLITE_AVAILABLE else "browser localStorage (--no-sqlite)"
    else:
        Handler.store = FavStore(pathlib.Path(args.db))
        Handler.history_store = HistoryStore(pathlib.Path(args.db))
        mode_msg = f"sqlite at {args.db}"

    Handler.config = Config(pathlib.Path(args.config))
    # All podman-touching ops go through the broker (host-side allow-list
    # service). One BrokerClient shared by both engine + image facades.
    broker = BrokerClient(pathlib.Path(args.broker_socket))
    Handler.engine_mgr = EngineBrokerClient(broker, Handler.engine)
    Handler.search_proxy = None if args.no_search else SearchProxy()
    # Desktop integration is owned by the broker now (writes ~/.local
    # /share/applications, runs xdg-mime, etc.). The web only carries
    # the host/port it was launched with so the broker can embed them
    # in the .desktop Exec= line on install. The --desktop-entry CLI
    # arg is no longer consulted — the path is fixed on the host side
    # (~/.local/share/applications/aceman.desktop), and the broker
    # is the single source of truth.
    Handler.desktop_entry = DesktopBrokerClient(
        broker, host=args.host, port=args.port,
    )
    Handler.gpu_client = GpuBrokerClient(broker)
    Handler.image_mgr = ImageBrokerClient(broker)
    Handler.players_client = PlayersBrokerClient(broker)
    Handler.browsers_client = BrowsersBrokerClient(broker)
    Handler.web_client = WebBrokerClient(broker)
    Handler.db_path = pathlib.Path(args.db)
    Handler.config_path = pathlib.Path(args.config)
    Handler.config_dir = Handler.db_path.parent

    # Build the router + DI context. Routes registered in
    # aceman/routes/* are wired here; the legacy if/elif in Handler's
    # do_* methods handles anything not yet migrated.
    Handler.route_ctx = RouteContext(
        engine=Handler.engine,
        store=Handler.store,
        history_store=Handler.history_store,
        config=Handler.config,
        config_path=Handler.config_path,
        config_dir=Handler.config_dir,
        db_path=Handler.db_path,
        engine_mgr=Handler.engine_mgr,
        gpu_client=Handler.gpu_client,
        image_mgr=Handler.image_mgr,
        players_client=Handler.players_client,
        browsers_client=Handler.browsers_client,
        web_client=Handler.web_client,
        desktop_entry=Handler.desktop_entry,
        search_proxy=Handler.search_proxy,
        heartbeat=Handler.heartbeat,
        no_local_desktop=args.wsl or args.no_local_desktop,
        # Engine-status route reads this so the polling tab can pick
        # up `acestream://` hand-offs (POST /api/play-request) from
        # a second wrapper invocation. Pure peek — the claim path
        # (POST /api/play-request/claim) is what atomically clears.
        pending_play_cid_peek=lambda: Handler._pending_play_cid,
    )
    Handler.router = Router()
    _register_routes(Handler.router)

    # Probe ffmpeg once at startup: if the local build has an H.264
    # decoder, the proxy will deinterlace + re-encode (full MSE
    # compatibility); otherwise it will fall back to remux-only (some
    # streams play, some don't — depends on source GOP shape).
    Handler._detect_ffmpeg_capabilities()
    Handler._detect_container_runtime()
    try:
        Handler._gpu_caps = Handler.gpu_client.status()
        _log("gpu", "caps: nvidia=%s vaapi=%s qsv=%s",
             bool(Handler._gpu_caps.get("nvidia")),
             bool(Handler._gpu_caps.get("vaapi")),
             Handler._gpu_caps.get("qsv", False))
    except Exception as e:
        _log("gpu", "capability probe failed: %s", e)
        Handler._gpu_caps = {}

    if Handler.config.get("engine_autostart") and not Handler.engine_mgr.probe(timeout=2):
        print("  engine_autostart=on; starting container...", flush=True)
        try:
            Handler.engine_mgr.start()
            print("  engine ready")
        except EngineError as e:
            print(f"  autostart failed: {e}", file=sys.stderr)

    browser_url = f"http://{args.host}:{args.port}/"
    # If the wrapper handed us an acestream://CID URL (xdg-mime dispatch
    # in playback_mode=browser), tack ?play=<cid> onto the URL so the
    # JS auto-plays after the page loads. Anything malformed is dropped
    # silently — the OS handler should never have routed a non-acestream
    # URL to us, and a typo'd cid isn't worth a hard error.
    if args.url:
        candidate = args.url
        if candidate.lower().startswith("acestream://"):
            candidate = candidate[len("acestream://"):]
        candidate = candidate.strip("/").lower()
        if HEX40.match(candidate):
            browser_url += f"?play={candidate}"

    # Single-instance handling for a port collision. Two paths:
    #   * --open-browser (desktop entry / acestream:// click): no terminal
    #     to prompt at, so just point the browser at whatever is already
    #     listening. Matches the user expectation of "the app I clicked
    #     came to the front".
    #   * Plain terminal launch: we have a TTY — confirm with the user
    #     that they want to terminate the existing instance and start
    #     fresh, instead of silently doing the wrong thing.
    def _bind():
        srv = ThreadingServer((args.host, args.port), Handler)
        Handler.httpd = srv
        return srv

    try:
        httpd = _bind()
    except OSError as e:
        if e.errno not in (errno.EADDRINUSE, errno.EACCES):
            raise
        # --takeover wins over --open-browser: /api/restart's spawned
        # wrapper carries both (we want it to take over, then it doesn't
        # need to also open a browser — the user is already looking at
        # this tab). Without this branch, --open-browser short-circuits
        # to "open browser at old instance" and the restart silently
        # fails to actually replace the running code.
        if args.takeover:
            if not _is_aceman_at(args.host, args.port):
                print("aceman_web: --takeover but port "
                      f"{args.port} doesn't look like another aceman_web; "
                      "refusing.", file=sys.stderr)
                return 1
            print(f"  --takeover: shutting down previous instance at "
                  f"http://{args.host}:{args.port}/...")
            _shutdown_other(args.host, args.port, stop_engine=False)
        elif args.open_browser:
            print(f"  port {args.port} already in use — handing URL to running instance")
            _open_in_chosen_browser(browser_url)
            return 0
        else:
            print(f"aceman_web: port {args.port} is already in use.",
                  file=sys.stderr)
            if not _is_aceman_at(args.host, args.port):
                print("  …and the listener doesn't look like another aceman_web.",
                      file=sys.stderr)
                print(f"  Refusing to touch it. Pick a different --port.",
                      file=sys.stderr)
                return 1
            if not sys.stdin.isatty():
                print("  Another aceman_web instance is responding on "
                      f"http://{args.host}:{args.port}/.", file=sys.stderr)
                print("  Re-run interactively or use `./aceman_web --stop` first.",
                      file=sys.stderr)
                return 1
            print(f"  Another aceman_web is responding on http://{args.host}:{args.port}/.",
                  file=sys.stderr)
            try:
                reply = input("  Terminate it and start fresh? [y/N] ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                reply = ""
            if reply not in ("y", "yes"):
                print("  Cancelled.", file=sys.stderr)
                return 1
            _shutdown_other(args.host, args.port, stop_engine=False)
        # stop_engine=False above leaves the engine container running —
        # we're about to take over and will share it. The previous
        # socket needs a moment to release; retry the bind
        # for up to ~5 s before giving up.
        for _ in range(20):
            time.sleep(0.25)
            try:
                httpd = _bind()
                break
            except OSError:
                continue
        else:
            print(f"  Port {args.port} did not free in time.", file=sys.stderr)
            return 1
        print("  Stopped previous instance; taking over.")

    # Install SIGTERM/SIGHUP handler now that httpd is bound and stored
    # on Handler. Anything that kills us from outside (pkill, systemd
    # stop, terminal hang-up) will now flow through the same teardown
    # path as Ctrl-C: in-flight proxy gets cleaned up and logs its
    # `ended` line, then serve_forever returns.
    _install_signal_handlers()

    if args.open_browser:
        # Server is already listening at this point (bound by ThreadingServer's
        # constructor), so a short delay is just to give serve_forever a beat
        # to accept the first connection rather than racing the OS scheduler.
        threading.Timer(0.5, lambda: _open_in_chosen_browser(browser_url)).start()
        print(f"  opening browser at {browser_url}")
    print(f"aceman_web listening on http://{args.host}:{args.port}/")
    print(f"  engine:  {Handler.engine}")
    print(f"  broker:  {args.broker_socket}")
    print(f"  favs:    {mode_msg}")
    print(f"  config:  {args.config}")
    print(f"  search:  {'search-ace.stream (proxied)' if Handler.search_proxy else 'disabled'}")
    print("  inbrowser: ffmpeg+libx264 (full re-encode, all streams)"
          if Handler._ffmpeg_has_h264_decoder
          else "  inbrowser: ffmpeg -c:v copy (remux only; some streams won't play)")
    print(f"  runtime: container ({'/run/.containerenv' if pathlib.Path('/run/.containerenv').exists() else '/.dockerenv'} present) — /api/restart routes via broker"
          if Handler._running_in_container
          else "  runtime: host — /api/restart spawns wrapper directly")
    if args.idle_timeout > 0:
        print(f"  idle:    web auto-shuts after {args.idle_timeout}s of silence "
              f"(engine stops too unless a host player is mid-stream)")
        _spawn_idle_watcher(args.idle_timeout)
    else:
        print("  idle:    auto-shutdown disabled")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        httpd.server_close()
    return 0


def _build_allowed_hosts(bind_host: str, port: int) -> "set[str] | None":
    """Construct the Host-header allow-list used by Handler._host_allowed.

    For loopback binds we accept '127.0.0.1', 'localhost', and '[::1]'
    (with and without the port suffix, since browsers normalise the port
    inconsistently — Host omits the port iff it's the scheme default).
    For 0.0.0.0 or any non-loopback host we return None, which disables
    the check: the admin has explicitly opted into LAN exposure, so DNS
    rebinding from outside isn't ours to defend against any more than
    inbound TCP itself was.
    """
    if bind_host == "0.0.0.0":
        return None
    if bind_host in ("127.0.0.1", "localhost", "::1"):
        bases = ["127.0.0.1", "localhost", "[::1]"]
    else:
        bases = [bind_host]
    out: "set[str]" = set()
    for b in bases:
        out.add(b)
        out.add(f"{b}:{port}")
    return out


def _is_aceman_at(host: str, port: int) -> bool:
    """Fingerprint the listener on (host, port) as another aceman_web.

    Used by the port-collision takeover path so we don't blindly POST
    /api/shutdown to whatever foreign service happens to be listening.
    Identifies by the `Server: aceman_web/...` response header that the
    Handler sets — same-origin is implied by talking to 127.0.0.1.
    """
    try:
        req = urllib.request.Request(
            f"http://{host}:{port}/api/storage-mode", method="GET")
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.headers.get("Server", "").startswith("aceman_web/")
    except (urllib.error.URLError, TimeoutError, socket.timeout,
            ConnectionError, OSError):
        return False


def _shutdown_other(host: str, port: int, *, stop_engine: bool) -> None:
    """Ask the other aceman_web on (host, port) to shut itself down.

    The other side races us — its socket closes mid-request — so the
    urlopen often raises with the response half-read. That's the success
    path; we swallow the error and let the caller's bind-retry loop be
    the real "did it work" check.
    """
    body = json.dumps({"stop_engine": stop_engine}).encode("utf-8")
    req = urllib.request.Request(
        f"http://{host}:{port}/api/shutdown",
        data=body, headers={"content-type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=3).read(1024)
    except (urllib.error.URLError, TimeoutError, socket.timeout,
            ConnectionError, OSError):
        pass


def _open_in_chosen_browser(url: str) -> None:
    """Open ``url`` in the browser the user picked in the UI.

    Resolution order:
      1. config.default_browser (+ default_browser_source) → ask the
         broker to spawn it on the host. The broker has DISPLAY / DBus /
         Wayland session env that the web container lacks, so this is
         the only path that actually launches a GUI browser when we
         run in the default containerised mode.
      2. Anything else (no preference, broker unreachable, browser
         uninstalled since last save) → fall back to the stdlib
         ``webbrowser.open``. In native mode that opens the OS
         default; in container mode it almost certainly fails, but
         we log and move on rather than crashing the request.
    """
    import webbrowser
    cfg = Handler.config
    bc = Handler.browsers_client
    name = cfg.get("default_browser", "") if cfg else ""
    source = cfg.get("default_browser_source", "") if cfg else ""
    if name and bc is not None:
        try:
            result = bc.spawn(name, source, url)
        except EngineError as e:
            _log("browsers", "spawn(%s/%s) broker error: %s",
                 name, source or "any", e)
            result = {"opened": False, "reason": str(e)}
        if result.get("opened"):
            _log("browsers", "opened %s in %s (%s)",
                 url, name, source or "any")
            return
        _log("browsers", "broker.spawn refused (%s); falling back to default",
             result.get("reason", "unknown"))
    webbrowser.open(url)


def _install_signal_handlers() -> None:
    """SIGTERM / SIGHUP → graceful shutdown.

    Without this, a `kill` or `pkill aceman_web` from outside the
    process tree terminates Python with the default disposition: no
    `finally` blocks run, so the in-flight proxy never logs its
    `ended cid=…` line and the user is left wondering why the stream
    just stopped. With the handler:
      1. Kill the active ffmpeg so the proxy thread's `stream.read()`
         returns EOF and its `finally` runs (logging duration/bytes).
      2. Trigger `httpd.shutdown()` from a daemon thread (it blocks on
         the serve loop, so it cannot be called from the same thread
         that's in serve_forever)."""
    def _handle_term(signum, _frame):
        _log("server", "received signal %d, shutting down", signum)
        with Handler._active_lock:
            proc = Handler._active_proc
            Handler._active_proc = None
        if proc is not None:
            Handler._kill_proc(proc)
        if Handler.httpd is not None:
            threading.Thread(target=Handler.httpd.shutdown,
                             daemon=True, name="sig-shutdown").start()
    for sig in (signal.SIGTERM, signal.SIGHUP):
        try:
            signal.signal(sig, _handle_term)
        except (OSError, ValueError):
            # SIGHUP missing on some platforms; signal.signal only works
            # on the main thread. Either way, not fatal.
            pass


def _spawn_idle_watcher(idle_timeout_s: int) -> None:
    """Background thread: poll the heartbeat; if no frontend request has
    arrived for ``idle_timeout_s`` seconds *after* the first one, stop
    the engine container (best effort, gated on no active player
    wrapper) and call httpd.shutdown().

    Engine-stop rules:
      * Wrapper alive (someone is playing via CLI `aceman <cid>` or via
        an active scheme-handler launch) → leave the engine running.
        Pulling the rug here would kill the player mid-stream.
      * Wrapper not alive → no tab AND no host player means nothing
        is using the engine. Stop the container so the user isn't
        paying RAM + bandwidth for an idle daemon.

    Skipped before the first request ever arrives so a
    `--open-browser`-less terminal launch stays up indefinitely."""
    # Poll often enough to react within a few seconds of the timeout
    # crossing, but not so often that we burn CPU on idle ticks.
    poll_interval = min(5, max(1, idle_timeout_s // 12))

    def _watch():
        while True:
            time.sleep(poll_interval)
            idle = Handler.heartbeat.idle_for()
            if idle is None or idle < idle_timeout_s:
                continue
            _log("server", "auto-shutdown: idle for %.0fs (> %ds threshold)",
                 idle, idle_timeout_s)
            # Probe wrapper liveness via the broker before deciding
            # whether to stop the engine. Wrapper_alive=true means a
            # host shell is mid-stream and the engine is in use even
            # though the browser isn't.
            wrapper_alive = False
            if Handler.engine_mgr is not None:
                try:
                    s = Handler.engine_mgr.broker.call(
                        "engine.status", timeout=5)
                    wrapper_alive = bool(s.get("wrapper_alive"))
                except EngineError as e:
                    _log("server", "auto-shutdown: wrapper probe failed "
                         "(treating as alive to be safe): %s", e)
                    wrapper_alive = True
            if wrapper_alive:
                _log("server", "auto-shutdown: host player active — "
                     "leaving engine running")
            elif Handler.engine_mgr is not None and Handler.engine_mgr.container_running():
                try:
                    Handler.engine_mgr.stop()
                    _log("server", "auto-shutdown: engine stopped "
                         "(no active host player)")
                except EngineError as e:
                    _log("server", "auto-shutdown: engine stop failed: %s", e)
            if Handler.httpd is not None:
                Handler.httpd.shutdown()
            return

    threading.Thread(target=_watch, daemon=True, name="idle-watcher").start()


if __name__ == "__main__":
    sys.exit(main())
