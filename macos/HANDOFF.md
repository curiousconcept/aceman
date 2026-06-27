# macOS handoff — validation brief

Audience: a tester on a real Mac, working with their own Claude. The
`macos/` kit was written and unit-tested on Linux by people without a
Mac, following the architecture in `PLAN.md`. Your job is to make it
actually run and fix what reality breaks. Treat every script as a
**starting point**, not gospel — the unknowns below are exactly the
spots we couldn't verify.

## The model in one paragraph

The whole aceman stack (broker + web + engine + podman) runs **unchanged**
inside a Lima Linux guest — the macOS analogue of WSL2+Ubuntu. macOS only
runs this thin `.command`/handler kit, which drives the guest via
`limactl shell` and reaches the web/engine over forwarded ports. The
broker and root wrappers are unchanged for macOS, and should stay that
way. (One deliberate `web/` change exists: `run.command` launches with
`--remote-desktop`, which hides Linux-desktop-only UI cards — the
App-launcher and native player target — exactly as WSL does. That's
expected; those cards can't act on a desktop the user reaches through
this kit.) If you find yourself wanting to add `darwin` branches to the
broker, stop — that's the heavy port we explicitly chose *not* to do
(see `PLAN.md`, "The decision").

## First run, in order

1. `./install.command` — Lima installs, guest boots + provisions.
2. Put `engine.tar.gz` in the guest (README step 2).
3. `./run.command` — web comes up, browser opens `http://localhost:8770/`.
4. `./get_url_stream.command <id>` — native IINA/VLC playback.
5. `internal/register-handler.command` — `acestream://` click-to-play.
6. `./stop.command`, `./update.command`, `./uninstall.command`.

## The unknowns we could NOT verify on Linux (check these first)

### 1. Port forwarding — the #1 risk
The kit launches the web with `--host 0.0.0.0` and the engine with
`ACE_API_HOST=0.0.0.0` so Lima's default rule forwards the ports to
macOS `127.0.0.1`. `internal/lima.yaml` also pins `portForwards` for 8770
and 6878.
- Confirm `curl http://localhost:8770/` from macOS reaches the web after
  `run.command`.
- Confirm a resolved stream URL (port 6878) actually plays from the Mac
  player. If not, the engine port isn't reaching the host — adjust the
  `portForwards` block (Lima ignores guest-`127.0.0.1`-bound ports by
  default; that's why we bind `0.0.0.0`).

### 2. Apple Silicon + the x86_64 engine
`internal/lima.yaml` requests `rosetta: {enabled: true}`.
- Confirm the engine **container image builds** in the guest (it pulls an
  amd64 base) and the acestream binary runs under Rosetta.
- This is the biggest "might just not be viable" item. Report timing —
  engine start, stream resolve latency. If Rosetta is unavailable on the
  host, the guest falls back to qemu (slow); note which you got.

### 3. The `acestream://` handler app
`register-handler.command` compiles `handler.applescript` with
`osacompile`, then overwrites `Contents/Info.plist` with
`handler-Info.plist`.
- Confirm `osacompile` still names the executable **`applet`** (the plist
  hardcodes `CFBundleExecutable=applet`). If the bundle won't launch,
  check that name and fix the plist.
- Confirm the `on open location` handler actually receives the URL
  (clicking an `acestream://` link, including the web UI's Play links).
- Confirm `duti -s … acestream all` sets the default cleanly, and that
  `unregister-handler.command` clears it.
- Gatekeeper may quarantine the freshly built app or block the
  `.command` files (right-click → Open, or `xattr -d com.apple.quarantine`).

### 4. Terminal automation
`run.command` uses `osascript`/Terminal to open the live-log window. On
first use macOS asks to grant Terminal automation permission. Confirm the
prompt path works; if the user runs from iTerm, adapt the AppleScript.

### 5. Lima home mount + repo
The kit clones the repo *inside* the guest (`~/Projects/aceman`) to avoid
Lima's read-only home mount. Confirm `engine.tar.gz` placement works and
the guest can build images. If you prefer mounting the Mac checkout
writable, that's a `mounts:` change in `lima.yaml` — but the in-guest
clone is the WSL-parity default.

## Explicitly out of scope (don't "fix" these)

- **VA-API / GPU transcode in the browser path.** Not possible on macOS;
  `gpu.py` already probes at runtime, finds no render node, and falls
  back to CPU. Leave it. GPU playback is the native-player path only.
- **Native (non-VM) web tier on macOS.** Rejected for parity + the
  AF_UNIX-across-VM problem (`PLAN.md`).
- **Broker `darwin` branches.** The broker never runs on macOS here.

## Tests

From `macos/`:

```
python3 -m unittest tests.test_macos_kit
```

It checks the handler plist declares the `acestream` scheme and that the
`.command`/`.sh` scripts are syntactically valid (`bash -n`). These run on
any OS. Everything else is manual on-hardware validation — capture what
you change back into these files so the kit improves for the next Mac.

## How to report back

For each numbered unknown above: PASS / FAIL + what you changed. Prioritize
1 and 2 — if the engine can't run or the ports don't forward, nothing else
matters. Keep edits inside `macos/`; if you think something *must* change
in `broker/`/`web/`, flag it for review rather than editing — it likely
means a different approach.
