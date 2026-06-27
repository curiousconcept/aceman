# Web app (`web/`)

```bash
./aceman_web
# then open http://127.0.0.1:8765/   (container mode publishes 8770)
```

The top-level `aceman_web` is a thin bash launcher that exec's
`python3 web/aceman_web.py`. Standard library only — no `pip install`.
The HTML/CSS/JS template parts are inlined into a single page at startup
(sentinel replacement), so a restart picks up edits and the browser
still gets one HTML response.

## Features

- **Engine** card — live status, Start/Stop, "Start on launch" checkbox.
- **Find streams** card — searches `search-ace.stream` via a **server-side
  proxy** (HTTPS-only, allow-listed host, no off-domain redirects, size
  cap, strict JSON parse, HEX40 content-id validation, Unicode bidi strip,
  result-count cap). The browser never talks to the upstream directly.
- **Play** — clicking Play / a search row / a favourite navigates the
  browser to `acestream://<cid>`. The OS scheme handler (installed by the
  desktop entry) routes it to the host `aceman` shell, which spawns the
  player and owns the engine session. The web never touches a player.
- **Favourites** column — search, pagination, double-click rename,
  days-since-watched badge, delete.

## Storage

- **Favourites** — SQLite at `~/.config/aceman/favorites.db` when the
  `sqlite3` module imports (default); falls back to browser `localStorage`.
  The header badge shows which is active.
- **Preferences** — `~/.config/aceman/config.json` (currently just
  `engine_autostart`).

## CLI flags

```
--engine http://127.0.0.1:6878   # engine base URL
--host 127.0.0.1                 # bind host
--port 8765
--db        ~/.config/aceman/favorites.db
--config    ~/.config/aceman/config.json
--broker-socket $XDG_RUNTIME_DIR/aceman/broker.sock
--no-sqlite                      # force browser-only favourites
--no-search                      # disable the search proxy endpoint
```

## HTTP endpoints

JSON over HTTP, same-origin only.

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
POST   /api/favs            {name, cid}               → 409 + existing_name on cid conflict
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

Playback is not a web endpoint: the web is for discovery and library
management; the shell `aceman` is the player-side. Server logs go to
stderr with ISO-timestamp tags:

```bash
./aceman_web 2>&1 | grep search:
```

Code layout, routing, and the broker facades are documented inline under
`web/aceman/`. The browser tier lives under `web/ui/` (per-domain js + css
+ html); pure modules live in `web/ui/lib/` and each domain's `lib/`, with
tests in `web/ui/tests/`.
