<p align="center">
  <img src="broker/assets/aceman.png" alt="aceman" width="140">
</p>

<h1 align="center">aceman</h1>

<p align="center">
  <a href="https://github.com/curiousconcept/aceman/actions/workflows/broker.yml"><img src="https://github.com/curiousconcept/aceman/actions/workflows/broker.yml/badge.svg?branch=main" alt="broker"></a>
  <a href="https://github.com/curiousconcept/aceman/actions/workflows/web.yml"><img src="https://github.com/curiousconcept/aceman/actions/workflows/web.yml/badge.svg?branch=main" alt="web"></a>
  <a href="https://github.com/curiousconcept/aceman/actions/workflows/js.yml"><img src="https://github.com/curiousconcept/aceman/actions/workflows/js.yml/badge.svg?branch=main" alt="js"></a>
</p>

Watch [Ace Stream](https://acestream.org) content from a **sandboxed
engine** — a rootless Podman container, managed and played through a
browser UI (a stdlib-Python web app), or with playback delegated to your
own Linux VLC/mpv (Flatpak supported). The browser app has **Favourites**,
watch **History**, and built-in stream **Search** (a server-side proxy to
`search-ace.stream`). Close the tab and it **auto-shuts down** — after a
short idle timeout the web server stops itself and the engine container,
so nothing keeps running (or eating bandwidth) in the background. A
host-side allow-list broker means the web never touches `podman` or
anything host-related directly.

<p align="center">
  <a href="https://www.patreon.com/cw/curiousconcept"><img src="web/curiousconcept-patreon-button-dark.png" alt="Support on Patreon" width="240"></a>
</p>

## Capabilities by OS

| Capability                              | Linux | Windows (WSL2)            | macOS |
|-----------------------------------------|:-----:|:------------------------:|:-----:|
| Sandboxed engine (rootless Podman)      |  ✅   | ✅ (inside WSL)          |  —    |
| Web UI (browser playback)               |  ✅   | ✅ (served to Windows)   |  —    |
| External-player CLI (`aceman` + VLC/mpv)|  ✅   | ✅ via `get_url_stream` → Windows VLC/mpv (GPU) |  —    |
| `acestream://` desktop handler          |  ✅   | ✅ opt-in (`register-handler`) |  —    |
| GPU / VA-API acceleration               |  ✅   | browser: server transcode on CPU (no VA-API in WSL) but decode on GPU · external Windows player: no transcode → full Windows GPU |  —    |
| One-click installer                     |  manual |  ✅ `wsl/install.bat`   |  —    |

## Quick start

### Linux

Requires rootless **Podman ≥ 4.0**, **Python ≥ 3.9** (stdlib only),
**bash ≥ 4**, and **curl** + **jq**. The web UI plays in your **browser**,
so **no media player is required**. A player (**VLC ≥ 3.0** or
**mpv ≥ 0.34**) is *optional* — only for the external-player CLI path
(`./aceman`), as an alternative to browser playback.

```bash
git clone https://github.com/curiousconcept/aceman.git
cd aceman
```

**One-time:** download the Ace Stream engine tarball (proprietary, not
shipped here) from **https://docs.acestream.net/products/#linux** — the
**Linux → Ubuntu, amd64 / py3.10** build — and save it as
`engine/container/dist/engine.tar.gz`. Details + hash verification:
[`engine/container/README.md`](engine/container/README.md).

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

## Dependencies

Deliberately small — beyond what your OS already ships, this is the whole list:

**On the host (installed once):**
- **Podman** (rootless) — the container runtime.
- **git**, **curl**, **jq** — used by the shell wrappers; usually already
  present on desktop Linux. On WSL, `install.bat` installs `podman git jq`
  for you.

**Inside the container images (built locally — nothing else touches your host):**
- *aceman-web* image (`python:3.11-slim`): **ffmpeg** for the in-browser
  stream transcode, plus `mesa-va-drivers` / `libva-drm2` /
  `mesa-vulkan-drivers` for GPU-accelerated ffmpeg.
- *engine* image (`ubuntu:22.04`): `python3` plus the engine's own runtime
  libs — via **apt**: `python3-apsw`, `python3-lxml`, `python3-nacl`,
  `python3-setuptools`; via **pip (pinned)**: `pycryptodome==3.20.0` (pip
  is removed from the image afterwards). Plus the **Ace Stream engine
  tarball you supply**. These are the *engine's* dependencies, not ours.

**Vendored in-tree (version-pinned + SHA-256 checked):**
- **mpegts.js** (Apache-2.0) — browser playback. See
  [`web/vendor/README.md`](web/vendor/README.md).

**Optional:**
- **VLC** or **mpv** — only for the external-player path. In-browser
  playback needs no player, but the web UI's Play links can also
  **delegate** to an external player (via the `acestream://` handler), the
  same external-player path the `aceman` CLI uses.

**Our** code adds no `pip install`, no `npm install`, no lock files — the
web and broker are stdlib-Python only, and the host footprint is Podman
plus a couple of shell tools. The single pinned `pip install` above is the
*engine image's* exception, for the proprietary engine's own runtime.

## Documentation

| Topic                         | Doc                                                  |
|-------------------------------|------------------------------------------------------|
| Engine image (build/run/env)  | [`engine/container/README.md`](engine/container/README.md) |
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

## Motivation

Built by someone security-conscious who doesn't want to guess what's
running on their machines. So aceman is a **safe project with minimal
dependencies** — not exposed to supply-chain attacks through a sprawling
dependency tree. It's built on **vanilla technologies**: standard-library
Python, plain shell, and dependency-free vanilla JavaScript, with the few
unavoidable third-party pieces vendored, version-pinned, and hash-checked.

**No binaries, no Docker images, no releases — what you see is what you
get: inspect, build, run.** And **Podman, not Docker** — rootless and
daemonless, so there's no privileged root daemon to trust or to attack.

It also wraps the Ace Stream engine **at arm's length**: the engine stays a
separate, sandboxed, untrusted component behind a host-side allow-list — so
the project is insulated against future changes to the engine, and keeps
working even if upstream shifts, the original authors move on, or the
surrounding ecosystem falls into disarray. Few moving parts, all readable,
nothing that rots quietly.

## License

aceman's own code is **MIT** — see [`LICENSE`](LICENSE). Exceptions:

- **Ace Stream engine** — proprietary, not included; you download it
  yourself and it's governed by Ace Stream's own terms.
- **`web/vendor/mpegts.min.js`** — bundled third-party library under
  **Apache-2.0** (see its header and [`web/vendor/README.md`](web/vendor/README.md)).

## Disclaimer

This project is an independent, open-source wrapper and automation utility.
It is **not affiliated with, endorsed by, or associated with Ace Stream**,
and it does **not bundle or distribute any proprietary software binaries or
copyrighted material** — the Ace Stream engine is downloaded by the user
from the official source, and any content you stream is your own
responsibility. "Ace Stream" and related marks belong to their respective
owners.
