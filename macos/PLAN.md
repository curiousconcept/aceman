# aceman on macOS — porting plan (macOS-light)

Status: **design + scaffolding.** Nobody on the core team has a Mac. We
land the host-side kit + docs here, then hand the on-hardware validation
to a tester running their own Claude. The brief is `HANDOFF.md`.

## The decision: mirror the WSL kit, don't port the broker

macOS has **no native Linux containers** — Docker Desktop, podman
machine, Colima, OrbStack all run a **Linux VM** and put containers
inside it. So a Linux container never shares the macOS kernel, which
means the web↔broker `AF_UNIX` socket can't cross the VM boundary and
the broker (whose whole job is to touch the *host*) is useless trapped
inside the VM.

Rather than fork the architecture for macOS (native web tier + a big
pile of `darwin` broker branches, diverging from WSL and doubling the
maintenance surface), we do what `wsl/` already does on Windows:

> **Run the entire Linux stack — broker, web, engine, podman — unchanged
> inside a Linux guest you own, and give macOS a thin kit of host-side
> helper scripts that talk to it over the published port + the `aceman`
> CLI.**

On Windows that guest is **WSL2 + Ubuntu**. On macOS it's **[Lima](https://lima-vm.io)**
(`brew install lima`) — a normal Linux VM you shell into, the direct
analogue of WSL. Inside the guest, aceman is just "aceman on Linux";
nothing in `broker/`, `web/`, or the wrappers changes. The empty
`darwin` stubs in `players.py` / `browsers.py` stay empty — correct,
because the broker never sees macOS.

This keeps **feature parity** with WSL (one model, not "WSL-light +
macOS-heavy") and keeps the container security layer intact.

## What this looks like

```
macOS host                          Lima guest (Linux, you own it)
──────────                          ──────────────────────────────
run.command       ── shell ───────► ./aceman_web   (broker + web container)
  └ open <url>  ◄── localhost:PORT ─┘                       │
get_url_stream.command ─ shell ───► ./aceman <id>           ▼
  └ open -a IINA <url>                          [engine container: acestream]
aceman-handler.app (acestream://) ─► get_url_stream.command (auto)
```

- **Web UI:** Lima forwards the guest port to macOS `localhost`, so
  Safari/Chrome open `http://localhost:PORT` like normal. (Port-forward
  details are the #1 thing the tester confirms — see `HANDOFF.md`.)
- **Native player path (the WSL "bonus"):** `get_url_stream.command`
  resolves an id to a URL via `aceman` in the guest and opens it in the
  Mac's VLC/IINA — which use the **Mac GPU directly**, sidestepping the
  no-VA-API-in-VM problem. Same trick `wsl/get_url_stream.bat` uses.
- **`acestream://` click-to-play:** a tiny `aceman-handler.app` declares
  the URL scheme (`CFBundleURLTypes`) and forwards clicks to
  `get_url_stream.command`. Registered with LaunchServices; made default
  via `duti` when present, else a one-line System-Settings instruction.
  This is the LaunchServices counterpart to `register-handler.bat`'s
  registry write.

## The macOS kit — counterparts to `wsl/`

| `wsl/` (Windows)              | `macos/` (Lima)                    | Job |
|------------------------------|------------------------------------|-----|
| `install.bat`                | `install.command`                  | install Lima, create+provision the guest, optional handler |
| `internal/setup.sh`          | `internal/setup.sh`                | provision the guest: podman, git, jq, clone repo |
| `run.bat`                    | `run.command`                      | launch `aceman_web`, wait for URL, open Mac browser |
| `get_url_stream.bat`         | `get_url_stream.command`           | resolve id → URL, copy to clipboard, open Mac VLC/IINA |
| `stop.bat`                   | `stop.command`                     | `aceman_web --stop`, then `limactl stop` |
| `update.bat`                 | `update.command`                   | `git pull` inside the guest |
| `uninstall.bat`              | `uninstall.command`                | `limactl delete`, remove the handler |
| `internal/register-handler.bat`   | `internal/register-handler.command`   | install + default the `acestream://` handler app |
| `internal/unregister-handler.bat` | `internal/unregister-handler.command` | remove it |
| `internal/aceman.ico`        | reuse `broker/assets/aceman.png` (→ `.icns` if wanted) | icon |
| —                            | `internal/handler.applescript` + `internal/handler-Info.plist` | URL-scheme handler source; `register-handler.command` builds the `.app` on the Mac via `osacompile` |

The provisioning split mirrors WSL exactly: a Windows/macOS launcher
that sets up the VM, and one `setup.sh` that runs *inside* the guest and
is nearly identical to `wsl/internal/setup.sh` (drop the
`/etc/wsl.conf`/systemd bits; add nothing Lima-specific that Lima's own
config doesn't already handle).

## Lima specifics the tester confirms (not guessable from Linux)

These are the genuine unknowns delegated to the Mac tester — see
`HANDOFF.md` for the checklist:

1. **Port forwarding.** Lima auto-forwards guest ports bound to
   `0.0.0.0` to `127.0.0.1` on macOS, but **not** ports bound only to
   guest-`localhost`. So either `aceman_web` must publish on `0.0.0.0`
   inside the guest, or `lima.yaml` needs an explicit `portForwards`
   entry. Confirm which, pin it in the Lima config the kit ships.
2. **Apple Silicon + the engine.** acestream is a **Linux x86_64**
   binary; on M-series Macs it runs under x86 emulation inside the Lima
   guest (Rosetta if the VM enables it, else qemu). Functional but
   possibly slow — the tester's chip and report decide viability. The
   shipped `lima.yaml` should request Rosetta (`rosetta: {enabled: true}`)
   on `aarch64` hosts.
3. **Home mount + repo location.** Lima mounts the macOS home
   read-only by default. The kit clones the repo *inside* the guest
   (like WSL) to avoid write-mount friction; confirm `engine.tar.gz`
   placement and that the guest can build images.
4. **LaunchServices.** That the handler `.app` actually catches
   `acestream://` clicks (including the web UI's Play links), and that
   `duti`/`lsregister` set + clear the default cleanly on uninstall.

## What's testable here vs on the Mac

Like `wsl/`, this kit is **host scaffolding** — shell + a plist — so most
of it is validated on hardware, not unit-tested. We add tests only where
there's real, host-agnostic logic:

- **`tests/test_macos_kit.py`** (runs on Linux): parse
  `internal/handler-Info.plist` with `plistlib` and assert it declares
  the `acestream` URL scheme + a sane bundle id; `bash -n` syntax-check
  every `.command`/`.sh` in `macos/`.

Everything else is in `HANDOFF.md` as a tester checklist.

## The one intentional `web/` change

Going light means no `broker/` or root-wrapper changes — but there is
**one** small, deliberate change in `web/`. The UI hides Linux-desktop-only
affordances (the App-launcher card, the native player target) when the
browser is on a different host. That was keyed on a WSL-specific flag
(`is_wsl`); under Lima the user's real desktop is equally elsewhere, so
the same cards must hide. The flag was generalized to **`no_local_desktop`**
(`aceman_web --no-local-desktop`, env `ACE_NO_LOCAL_DESKTOP`): WSL auto-detect
sets it, and `macos/run.command` passes it explicitly. We don't *auto-detect*
Lima — a Lima guest is plain Ubuntu with no reliable kernel marker like
WSL's `/proc/sys/kernel/osrelease`, and `--wsl` also carries WSL-only
networking (guest-IP URL) we don't want. Covered by
`web/tests/test_routes_storage_search.py`.
