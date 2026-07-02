# aceman on macOS (Lima)

aceman runs inside a small Linux VM (**[Lima](https://lima-vm.io)**) and
serves its web UI to your Mac browser. This folder is a self-contained
kit of double-click `.command` scripts that set it up and launch it — you
don't need to touch the Linux command line for normal use.

> This is the macOS equivalent of the `wsl/` kit for Windows: the whole
> aceman stack runs in the Linux guest, and macOS reaches it over a
> forwarded port. **Status: community-tested.** The core team has no Mac;
> if something is off, see `HANDOFF.md` and the troubleshooting notes.

## GPU / playback

- **Browser playback** transcodes on the **CPU** inside the VM — there's
  no VA-API hardware transcode on macOS (Metal-only GPU, same dead end
  WSL has). Fine for most streams; heavy 4K may strain the CPU.
- **Hardware-accelerated playback** is available via the **native player
  path** below (`get_url_stream.command` → IINA/VLC), which decodes
  through VideoToolbox on your real GPU. Prefer it for heavy streams.

## Requirements

- macOS 13+ (Apple Silicon or Intel).
- **Homebrew** — https://brew.sh (the installer uses it to get Lima).
- Disk: ~a few GB for the VM image + container images.
- Apple Silicon: the engine is a Linux x86_64 binary and runs under
  Rosetta emulation in the VM. It works, but is the least-tested path.

## 1. Install — `install.command`

Double-click **`install.command`** (or run it in Terminal). It:

1. Installs **Lima** via Homebrew (if missing).
2. Creates + starts the **`aceman`** Linux guest from `internal/lima.yaml`
   (first boot downloads an Ubuntu image).
3. Provisions the guest: installs `podman git jq` and clones the repo to
   `~/Projects/aceman` **inside the guest**.

> First run is double-clickable, but macOS may block a downloaded
> `.command`. If so: right-click → **Open**, or **System Settings →
> Privacy & Security → Open Anyway**. You can also just run it in
> Terminal.

## 2. Provide the engine tarball (one-time, required to play)

The Ace Stream engine tarball isn't shipped in the repo (it's
proprietary). The web UI runs without it, but **playback needs it**.

**Easy way — `import_engine.command`.** Double-click it. It looks in your
Mac **Downloads** for a file named like
`acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz` and installs it into
the guest as `engine.tar.gz`. If it isn't there yet, it prints the download
link and **waits** — download the file in your browser, then press Enter in
the window to finish.

**Manual way.** If you'd rather place it yourself:

1. Download from **https://docs.acestream.net/products/#linux** — the
   **Linux → Ubuntu, amd64 / py3.10** build (same one WSL uses).
2. Open the guest shell:

   ```
   limactl shell aceman
   ```

3. Place the file, renamed to `engine.tar.gz`, at:

   ```
   ~/Projects/aceman/engine/container/dist/engine.tar.gz
   ```

   (Inside the guest, `~` is the Linux home. You can `cp` it from your
   Mac home, which Lima mounts read-only at the same path.)

See [`../engine/container/README.md`](../engine/container/README.md) for
verifying it against the `.sha256`.

## 3. Launch — `run.command`

Double-click **`run.command`**. It:

- opens a second Terminal window with the **live server logs**,
- waits for the server to come up (first launch builds container images —
  a few minutes),
- opens `http://localhost:8770/` in your default Mac browser.

Keep the log window open while you use aceman; close it to stop the
server.

## Play in macOS IINA / VLC (optional, GPU-accelerated)

Prefer your Mac player over browser playback? Use
**`get_url_stream.command`** — give it an Ace Stream id (or run it with no
argument and it prompts). It starts the engine if needed, resolves a
playback URL, copies it to your clipboard, and offers to open it in IINA
or VLC. Because the player runs natively on macOS, it's
**hardware-accelerated** (VideoToolbox) — the reason to prefer this for
heavy streams.

## `acestream://` click-to-play (optional)

Want `acestream://` links to just play when clicked — including the
**Play** links in the web UI? Register the handler once:

```
internal/register-handler.command
```

It builds a tiny handler app that routes `acestream://` clicks to
`get_url_stream.command` (IINA/VLC). Setting it as the *default* handler
uses **`duti`** if installed (`brew install duti`); otherwise the app is
registered and you pick "aceman" the first time macOS prompts.

- **Requires IINA or VLC** — registration is refused with a clear message
  if neither is found.
- The handler stores this folder's path; if you move the kit, re-run it.
- Remove it with `internal/unregister-handler.command` (uninstall does
  this too).

## Stop — `stop.command`

Gracefully stops the web + engine containers, then stops the Lima guest.

## Update — `update.command`

Force-updates the guest clone: fetches GitHub and **hard-resets** to the
latest code (local repo edits are discarded — your favourites live outside
the repo in the guest's `~/.config/aceman`, so they're kept). Read the
trust note it prints first.

Pass a branch name to update to something other than `main`, e.g. to try a
feature branch:

```
./update.command some-branch
```

With no argument it updates the branch the clone is on (or `main`). Inside
the guest the same job is `./update.sh [branch]`.

## Back up / restore favourites — `backup_to_downloads.command` / `restore_from_downloads.command`

**`backup_to_downloads.command`** saves your aceman favourites (and prefs)
from inside the guest into your Mac **Downloads**, as a timestamped
`aceman-backup-…` folder. Run it any time; `uninstall.command` also
**offers** it before deleting anything.

**`restore_from_downloads.command`** is the reverse — it copies a backup
folder back into `~/.config/aceman` in the guest. With no argument it
restores the newest `aceman-backup-…` in Downloads. Stop aceman (close the
web UI) before restoring, then relaunch to see the favourites.

> These rely on `~/Downloads` being **mounted writable** into the guest
> (set in `internal/lima.yaml`). A guest created before that mount was
> added won't have it — recreate it (`limactl delete aceman` then
> `install.command`) or run `limactl edit aceman`.

## Uninstall — `uninstall.command`

Removes the `acestream://` handler and **deletes the Lima `aceman` guest
and everything in it.** Confirms first, and **offers to back up your
favourites to Downloads first** (via `backup_to_downloads.command`). Leaves
Lima itself installed (`brew uninstall lima` to remove).

## Files in this kit

| File                         | What |
|------------------------------|------|
| `install.command`            | Install Lima, create + provision the guest |
| `run.command`                | Launch aceman_web and auto-open the browser |
| `import_engine.command`      | Install the engine tarball from Downloads (waits if missing) |
| `get_url_stream.command`     | Resolve an id to a URL for native IINA/VLC |
| `backup_to_downloads.command` | Save favourites to your Mac Downloads |
| `restore_from_downloads.command` | Restore favourites from a Downloads backup |
| `stop.command`               | Stop containers + the Lima guest |
| `update.command`             | Force-update the project inside the guest (optional branch arg) |
| `uninstall.command`          | Delete the guest + remove the handler (offers a favourites backup first) |
| `internal/lima.yaml`         | Lima VM config (image, Rosetta, port forwards) |
| `internal/setup.sh`          | Guest provisioning (podman, git, clone) |
| `internal/handler.applescript` | `acestream://` open-location handler source |
| `internal/handler-Info.plist`  | handler app plist (declares the URL scheme) |
| `internal/register-handler.command`   | install + default the handler |
| `internal/unregister-handler.command` | remove the handler |

See **`PLAN.md`** for the architecture rationale and **`HANDOFF.md`** for
the on-hardware validation checklist.
