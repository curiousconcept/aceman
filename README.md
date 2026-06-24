# aceman

Watch [Ace Stream](https://acestream.org) content from a **sandboxed
engine** — rootless Podman container, a browser UI, and a host-side
allow-list broker so the web never touches `podman` directly.

[Support on Patreon](https://www.patreon.com/cw/curiousconcept)

## Capabilities by OS

| Capability                              | Linux | Windows (WSL2)            | macOS |
|-----------------------------------------|:-----:|:------------------------:|:-----:|
| Sandboxed engine (rootless Podman)      |  ✅   | ✅ (inside WSL)          |  —    |
| Web UI (browser playback)               |  ✅   | ✅ (served to Windows)   |  —    |
| External-player CLI (`aceman` + VLC/mpv)|  ✅   | ⚠️ no GPU in WSL — use web|  —    |
| `acestream://` desktop handler          |  ✅   | ❌ (use the web UI)      |  —    |
| GPU / VA-API acceleration               |  ✅   | ❌ (broken under WSL)    |  —    |
| One-click installer                     |  manual |  ✅ `wsl/install.bat`   |  —    |

## Quick start

### Linux

Requires rootless **Podman ≥ 4.0**, **Python ≥ 3.9** (stdlib only),
**bash ≥ 4**, **curl** + **jq**, and a player (**VLC ≥ 3.0** or
**mpv ≥ 0.34**) for the CLI path.

```bash
git clone https://github.com/curiousconcept/aceman.git
cd aceman
```

**One-time:** download the Ace Stream engine tarball (proprietary, not
shipped here) from **https://docs.acestream.net/products/#linux** — the
**Linux → Ubuntu, amd64 / py3.10** build — and save it as
`container/engine/dist/engine.tar.gz`. Details + hash verification:
[`container/engine/README.md`](container/engine/README.md).

Then:

```bash
./aceman_web                 # web UI  → http://127.0.0.1:8765/
# or
./aceman <content_id>        # external player (40-hex id or acestream://…)
```

Player install hints:

| Distro            | Command                                                          |
|-------------------|------------------------------------------------------------------|
| Fedora / RHEL     | `sudo dnf install vlc mpv`                                        |
| Fedora Silverblue | `rpm-ostree install vlc mpv` *or* `flatpak install org.videolan.VLC io.mpv.Mpv` |
| Debian / Ubuntu   | `sudo apt install vlc mpv`                                        |
| openSUSE          | `sudo zypper install vlc mpv`                                     |
| Arch              | `sudo pacman -S vlc mpv`                                          |

### Windows (WSL2)

Grab the repo ZIP —
[direct download](https://github.com/curiousconcept/aceman/archive/refs/heads/main.zip) —
extract it, open the `wsl/` folder, then double-click `install.bat`
followed by `run.bat`. As on Linux, you'll do the **one-time engine
tarball download** (from
[docs.acestream.net](https://docs.acestream.net/products/#linux)) and
drop it into the clone — `wsl/README.md` shows the exact Windows path.
Prefer Windows VLC/mpv over browser playback? `get_url_stream.bat <id>`
hands a stream URL to your player. Full steps:
**[`wsl/README.md`](wsl/README.md)**.

### macOS

_Not supported yet._

## Documentation

| Topic                         | Doc                                                  |
|-------------------------------|------------------------------------------------------|
| Engine image (build/run/env)  | [`container/engine/README.md`](container/engine/README.md) |
| Web app (UI, endpoints, flags)| [`web/README.md`](web/README.md)                     |
| Broker (allow-list, socket)   | [`broker/README.md`](broker/README.md)               |
| CLI `aceman` + favourites     | [`docs/cli.md`](docs/cli.md)                          |
| Player buffering (VLC/mpv)    | [`docs/players.md`](docs/players.md)                  |
| Threat model                  | [`docs/security.md`](docs/security.md)               |
| Windows / WSL kit             | [`wsl/README.md`](wsl/README.md)                     |

## How it fits together

```
[shell wrappers] ─▶ [Python web (containerised)] ─▶ [broker (host allow-list)] ─▶ [podman]
                                                              │
                                                              ▼
                                                   [engine container: acestream]
```

The web sends one JSON action per line to the broker over a `0600` unix
socket; the broker owns every host-touching operation. That boundary is
the security model — see [`docs/security.md`](docs/security.md).
