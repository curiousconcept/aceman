# aceman

https://www.patreon.com/cw/curiousconcept

Watch [Ace Stream](https://acestream.org) content from a sandboxed engine on
Linux. The project ships four pieces that work together:

- **`container/engine/Containerfile` + `container/engine/run-container.sh`** — the Ace Stream
  engine inside a locked-down rootless Podman container.
- **`aceman`** — a shell CLI that talks to the engine's HTTP API, launches
  a local player, and tracks favourites in a flat file.
- **`aceman_web`** (+ `web/`) — a Python 3 web frontend (standard
  library only) that exposes the same workflow in a browser, plus a
  server-side search proxy and richer favourites management. The
  top-level `aceman_web` is a thin bash launcher that exec's
  `python3 web/aceman_web.py`.
- **`broker/aceman-broker`** — a tiny stdlib Python service that
  exposes a fixed allow-list of six podman ops on a unix socket. The
  web frontend never touches `podman` directly; it sends one JSON line
  per action to the broker. Container name + image tag are frozen at
  broker startup, so no field from a request ever reaches an argv.

---

## Requirements

| Component         | What                                                                                       | Notes                                                                                       |
|-------------------|--------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| OS                | Linux                                                                                      | Any distro with rootless Podman. WSL2 works too — `aceman_web` auto-detects and serves to the Windows side. |
| Podman            | ≥ 4.0, rootless                                                                            | Preinstalled on most modern distros; Debian/Ubuntu may need `slirp4netns` + `subuid`/`subgid`.       |
| Python            | ≥ 3.9                                                                                      | Only needed for `aceman_web`. **Standard library only — no `pip install` required.**      |
| Bash              | ≥ 4                                                                                        | For `aceman` and `container/engine/run-container.sh`.                                            |
| `curl`, `jq`      | any recent version                                                                         | Used by the `aceman` shell script.                                                        |
| Player            | one of: **VLC** ≥ 3.0 *or* **mpv** ≥ 0.34, from your system package manager *or* Flatpak.  | Auto-detected: PATH → installed RPM/dpkg package → Flatpak (`org.videolan.VLC`, `io.mpv.Mpv`). |
| Engine tarball    | `acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz` saved as `container/engine/dist/engine.tar.gz`         | Download from `acestream.media`. No upstream signature exists — record your own SHA-256.    |

### Install hints by distro

| Distro                | Player install                                                |
|-----------------------|---------------------------------------------------------------|
| Fedora / RHEL         | `sudo dnf install vlc mpv`                                    |
| Fedora Silverblue     | `rpm-ostree install vlc mpv` *or* `flatpak install org.videolan.VLC io.mpv.Mpv` |
| Debian / Ubuntu       | `sudo apt install vlc mpv`                                    |
| openSUSE              | `sudo zypper install vlc mpv`                                 |
| Arch                  | `sudo pacman -S vlc mpv`                                      |

---

## Build the engine image

Place `engine.tar.gz` in the `dist/` directory (create it if needed),
record its hash, then build:

```bash
mkdir -p dist
mv engine.tar.gz container/engine/dist/
sha256sum container/engine/dist/engine.tar.gz | tee container/engine/dist/engine.tar.gz.sha256
podman build -t localhost/acestream:vetted \
    -f container/engine/Containerfile container/engine
```

Everything for the engine image lives under `container/engine/`: the
`Containerfile`, the `dist/` tarball it copies, and the
`run-container.sh` launcher. Build context is `container/engine/`
itself, so `COPY dist/engine.tar.gz` resolves locally. (The aceman-web
image lives under `container/aceman-web/` with the same shape — see
`container/aceman-web/Containerfile.web`.)

`.containerignore` (at the project root, where the build context lives)
keeps the build context small and the layer cache stable.

---

## Run the engine

```bash
./container/engine/run-container.sh
```

Runs in the foreground; Ctrl-C stops it.

### `container/engine/run-container.sh` environment variables

All knobs below apply to direct invocations of `container/engine/run-container.sh`.
When `aceman` or `aceman_web` start the engine on your behalf they set
these themselves (notably `ACE_DETACH=1`) — you don't.

| Var              | Default                          | Meaning                                                              |
|------------------|----------------------------------|----------------------------------------------------------------------|
| `ACE_IMAGE`      | `localhost/acestream:vetted`     | Image tag.                                                           |
| `ACE_NAME`       | `ace`                            | Container name.                                                      |
| `ACE_API_PORT`   | `6878`                           | Loopback-bound host port for the HTTP API. (Alias: `ACE_PORT`.)      |
| `ACE_MEMORY`     | `5g`                             | `--memory` cap on the container.                                     |
| `ACE_CACHE_SIZE` | `3g`                             | `--tmpfs` size for `/home/ace/.ACEStream`; engine self-evicts at ~90 %. |
| `ACE_DETACH`     | `0`                              | Set to `1` to add `-d` (background) and return immediately. Used by `aceman` and `aceman_web` when starting the engine on demand. |

Hardening flags applied by `container/engine/run-container.sh`: `--cap-drop=ALL`,
`--security-opt no-new-privileges`, `--read-only`, tmpfs for `/tmp` and
`/home/ace/.ACEStream`, memory/PID caps, and `--add-host` entries that
null-route Ace Stream's statistics endpoints.

---

## CLI: `aceman`

```
aceman <content_id>          # 40-hex content id or acestream://<id>
aceman --url <transport_url>
aceman --infohash <infohash>
aceman --fav <name…>         # play a saved favourite (case-insensitive,
                               # words after --fav are joined — no quotes needed)
aceman --list                # list saved favourites
```

What it does:

- Probes the engine. If unreachable, starts it via `ACE_DETACH=1 ./run.sh`
  and polls for up to 30 s.
- Calls `/ace/getstream?format=json`, validates URLs, launches the player.
- On exit, ends the *stream session* (`command_url?method=stop`). The
  *engine container* keeps running so quick channel-switching is fast — a
  banner reminds you with the `podman stop ace` command to fully shut down.
- Default player is `vlc`; override with `ACE_PLAYER=mpv` or any binary that
  accepts a URL as a positional argument.
- After the player closes, you're prompted to save the stream as a favourite
  (skip with empty input). Suppressed when stdin isn't a TTY, when the
  stream was already loaded from a favourite, or when the cid is already
  in the file.

Favourites file: `~/.config/aceman/favorites` (tab-separated `name<TAB>id`).
Blank lines and `#` comments are skipped.

---

## Broker: `aceman-broker`

The web frontend doesn't talk to `podman` directly. It sends one JSON
line per action over a unix socket to a host-side broker process that
exposes a fixed six-action allow-list:

```
engine.start | engine.stop  | engine.status
image.install | image.remove | image.status
```

For each action, the broker runs a hardcoded `podman` argv. Container
name and image tag are read from env at broker startup and frozen — no
field from a request ever reaches the command line. The socket lives at
`$XDG_RUNTIME_DIR/aceman/broker.sock`, mode `0600`, inside the user's
runtime dir (mode `0700`), so only your own UID can open it.

**No install step.** The `aceman_web` wrapper auto-spawns the broker
on launch if its socket isn't already there, using `setsid -f` so the
broker outlives the wrapper and serves any later launches in the same
user session. Crashes self-heal on the next `aceman_web` run.

For debugging, run the broker directly in a terminal so its stderr is
visible:

```bash
./broker/aceman-broker
```

Env vars (read once at broker startup; override by exporting before the
first launch):

| Var               | Default                          | Notes                                              |
|-------------------|----------------------------------|----------------------------------------------------|
| `ACE_NAME`        | `ace`                            | Container name the broker manages.                 |
| `ACE_IMAGE`       | `localhost/acestream:vetted`     | Image tag the broker builds and runs.              |
| `ACE_ENGINE_URL`  | `http://127.0.0.1:6878`          | Engine HTTP API for the `engine.status` probe.     |
| `ACE_PROJECT_ROOT`| auto-detected from script path   | Build context root + location of `container/`.     |

If the broker isn't running for any reason, the web UI surfaces a
"broker not running" message on the engine/image cards and continues
working for everything else (search, favourites, settings). The host
shell `aceman` doesn't go through the broker — it talks to `podman`
directly, since it's already the trusted user code on the host.

---

## Web app: `aceman_web`

```bash
./aceman_web
# then open http://127.0.0.1:8765/
```

The launcher is a small bash wrapper that exec's `python3 web/aceman_web.py`.
All Python lives under `web/`:

```
web/
├── aceman_web.py   # server (Handler, managers, FavStore, …)
├── config.py         # constants (paths, regexes, size caps)
├── html/index.html   # markup with /*__ACEWATCH_CSS_HERE__*/ and
│                     #   //__ACEWATCH_JS_HERE__ sentinels
├── css/style.css
└── js/app.js
```

The three template parts are inlined into a single page at startup
(sentinel replacement) — a restart picks up css/js/html edits, and the
browser still sees one HTML response with no extra roundtrips.

Features:

- **Engine** card — live status, Start/Stop button, "Start on launch" checkbox.
- **Find streams** card — searches `search-ace.stream` via a **server-side
  proxy** (HTTPS-only, allow-listed host, no off-domain redirects, size cap,
  strict JSON parse, HEX40 content-id validation, Unicode bidi strip on
  names, result-count cap). The browser never talks to the upstream
  directly. Insta-save adds the result to favourites and warns if the
  content id is already saved.
- **Play** — clicking Play (or a search row, or a favourite) navigates
  the browser to `acestream://<cid>`. The OS scheme handler (installed
  by this app's desktop entry) routes the URL to the host `aceman`
  shell, which spawns the player and owns the engine session. The web
  itself never touches a player binary.
- **Favourites** column — search, pagination, double-click to rename,
  days-since-watched badge, delete. Sits on the left at ≥ 1400 px viewport,
  stacks below otherwise.

Storage:

- **Favourites** — SQLite at `~/.config/aceman/favorites.db` when the
  `sqlite3` module is importable (default). Falls back to browser
  `localStorage` otherwise. The header badge shows which is active.
- **Server-side preferences** — `~/.config/aceman/config.json`
  (currently just `engine_autostart`).

CLI flags:

```
--engine http://127.0.0.1:6878         # engine base URL
--host 127.0.0.1                       # bind host
--port 8765
--db        ~/.config/aceman/favorites.db
--config    ~/.config/aceman/config.json
--broker-socket $XDG_RUNTIME_DIR/aceman/broker.sock
                                       # aceman-broker socket; the broker owns
                                       # container name + launcher path internally.
--no-sqlite                            # force browser-only favourites
--no-search                            # disable the search proxy endpoint
```

HTTP endpoints (JSON over HTTP, same-origin only):

```
GET    /api/storage-mode    {mode, engine}
GET    /api/engine/probe    {up}
GET    /api/engine/status   {up, container}
POST   /api/engine/start                              # via broker
POST   /api/engine/stop                               # via broker
GET    /api/engine/image                              # build/install state
POST   /api/engine/image                              # build (install)
DELETE /api/engine/image                              # remove
GET    /api/config
POST   /api/config          {engine_autostart?}
GET    /api/favs
POST   /api/favs            {name, cid}               → 409 with existing_name on cid conflict
POST   /api/favs/touch      {cid}                     # stamp last_played
PATCH  /api/favs/<name>     {name: newname}
DELETE /api/favs/<name>
GET    /api/search?q=…      {results:[{cid, name, translated_name}]}
POST   /api/shutdown        {stop_engine?}            # default false
POST   /api/factory-reset   {confirm:"RESET"}
GET    /api/desktop-entry/app
POST   /api/desktop-entry/app   {register_scheme?}
DELETE /api/desktop-entry/app
```

Playback itself is not a web endpoint anymore: clicking Play, a search
row, or a favourite navigates to `acestream://<cid>`, and the OS scheme
handler routes that to the host `aceman` shell, which owns the engine
session, the player launch, and the single-active-session lock. The web
is for discovery and library management; the shell is the player-side.

Server logs go to stderr with ISO-timestamp tags. Filter:

```bash
./aceman_web 2>&1 | grep search:
```

---

## Buffering / cache settings

P2P live streams jitter — give the player a few seconds (or tens of seconds)
of cache so it can ride that out instead of stalling at every blip.

### VLC

GUI path (where the *60 000 ms* setting you were hunting lives):

> **Tools → Preferences → Show settings: All** *(bottom-left radio)* **→ Input / Codecs**

| Setting                      | What it covers                                         | Sensible range        |
|------------------------------|--------------------------------------------------------|-----------------------|
| **Network caching (ms)**     | HTTP, RTSP, etc. — what the Ace Stream engine serves   | `5000`–`30000`        |
| **HTTP caching (ms)**        | HTTP specifically (per-protocol override)              | match Network caching |
| **Live caching (ms)**        | HLS / DVB / SDP live inputs                            | `5000`–`30000`        |
| Disc / File caching          | irrelevant for Ace Stream                              | leave defaults        |

If you'd set it to **60 000 ms (1 minute)** and want to back it off,
reopen that same panel and drop Network caching to e.g. `10000` (10 s) →
Save → reopen the stream.

Command-line equivalent (same flags work for the Flatpak):

```bash
vlc --network-caching=10000 --http-caching=10000 URL
flatpak run org.videolan.VLC -- --network-caching=10000 URL
```

### mpv

mpv has a comparable cache. Put these in `~/.config/mpv/mpv.conf` for the
system install, or `~/.var/app/io.mpv.Mpv/config/mpv/mpv.conf` for the
Flatpak:

```ini
cache=yes
cache-secs=20              # seconds of audio/video buffered ahead of the play head
demuxer-readahead-secs=20  # how far ahead the demuxer fetches
demuxer-max-bytes=200MiB   # hard ceiling on cached data
```

Or one-shot from the command line:

```bash
mpv --cache=yes --cache-secs=20 URL
```

Trade-off: higher cache = smoother playback but later to start. The
"nothing happens for a minute then it plays" feeling is exactly what 60 s
of network caching looks like.

---

## Threat model

The Ace Stream engine is treated as an untrusted input source — its HTTP
responses are size-capped, JSON-parsed strictly, URL-validated (scheme
forced to `http`, authority rewritten to the engine endpoint we configured),
and control bytes are scrubbed before anything is shown to the user. The
container has `cap-drop=ALL`, `no-new-privileges`, a read-only rootfs,
tmpfs scratch, memory + PID caps, and a **loopback-only** port binding (no
inbound NAT punch-through).

`search-ace.stream` is treated identically: server-side proxy, HTTPS-only,
allow-listed host, no off-domain redirects, JSON re-projected into a
minimal `{cid, name, translated_name}` shape with control-byte and Unicode
bidi-override stripping on names.

The container limits the blast radius **if** the binary misbehaves but
does **not** protect against P2P deanonymisation — the swarm sees your IP.
For that, pair the engine with a VPN egress sidecar (e.g. Gluetun) and
disable UPnP on your router so the engine can't punch its own inbound hole.

---

## Project layout

```
.
├── .containerignore       # keep the build context small + cache stable
├── container/
│   ├── engine/                  # everything for the acestream engine image
│   │   ├── Containerfile        # ubuntu:22.04 + dist/engine.tar.gz, runs as user 'ace'
│   │   ├── run-container.sh     # rootless podman run with hardening flags
│   │   └── dist/
│   │       ├── engine.tar.gz    # Ace Stream Linux tarball (provide it yourself)
│   │       └── engine.tar.gz.sha256   # your locally-recorded hash
│   └── aceman-web/              # everything for the aceman web image
│       ├── Containerfile.web    # python:slim + ffmpeg, runs web/aceman_web.py
│       └── run-web-container.sh # rootless podman run, mounts broker socket
├── aceman               # shell CLI
├── aceman_web           # bash launcher → web/aceman_web.py
├── aceman_web_stop      # curl wrapper for /api/shutdown
├── broker/
│   └── aceman-broker         # stdlib Python allow-list service (unix socket).
│                               # Auto-spawned by ./aceman_web; no install step.
├── web/
│   ├── aceman_web.py    # stdlib-only Python web frontend
│   ├── config.py          # constants
│   ├── html/index.html
│   ├── css/style.css
│   ├── js/app.js         # entry-point ES module
│   └── js/lib/           # extracted pure modules (unit-tested below)
├── web/js_tests/         # Node stdlib `node:test` suites (~125 tests)
└── README.md              # this file
```
