# aceman on Windows (WSL2)

aceman runs inside WSL2 (Ubuntu) and serves its web UI to your Windows
browser. This folder is a self-contained kit of Windows `.bat` scripts
that set everything up and launch it — you don't need to touch the Linux
command line.

> GPU/VA-API acceleration does **not** work under WSL, so the external-
> player CLI path isn't useful here. Use the **web UI** (browser playback),
> which is what these scripts launch.

## Get the files onto Windows

Quickest — direct ZIP of the whole repo, no clicking around GitHub:

> **https://github.com/curiousconcept/aceman/archive/refs/heads/main.zip**

Download, extract, and open the `wsl/` folder inside. Keep all the files
in that folder together. (Equivalent: on the repo page, **Code → Download
ZIP**.)

## 0. Make sure WiFi reconnects after reboot

Install reboots midway, and the next phase needs internet to download
packages and clone the repo. In **Settings → Network & Internet → WiFi →
your network**, ensure **"Connect automatically when in range"** is
ticked. Otherwise the reboot comes back offline and provisioning fails.

## 1. Install — `install.bat`

Double-click **`install.bat`** and approve the UAC prompts. It:

1. Enables WSL, reboots (asks first — make sure WiFi auto-connects at
   startup, since the next phase downloads packages).
2. After reboot, auto-installs Ubuntu and provisions it: creates user
   `ace`, installs `podman git jq`, enables systemd (so `podman stats`
   reports memory), and clones the repo to `~/Projects/aceman`.
3. Creates an **aceman** shortcut on your Desktop.
4. Asks whether to enable **shared networking** so another device
   (phone/tablet) can play streams over your LAN — see below. Answer
   **N** if unsure; you can turn it on later.

## 2. Provide the engine tarball (one-time, required to play)

The Ace Stream engine tarball isn't shipped in the repo (it's
proprietary). The web UI runs without it, but **playback needs it**.

`install.bat` **offers this at the end of provisioning** — say **Y** there
and it runs the import for you (see below). If you skipped it, or are setting
up playback later, do it yourself:

**Easy way — `import_engine.bat`.** Double-click it. It looks in your
Windows **Downloads** for a file named like
`acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz` and installs it into
the clone as `engine.tar.gz` for you. If it isn't there yet, it prints the
download link and **waits** — download the file in your browser, then press
Enter in the window to finish. (It stays open the whole time.)

Before installing it, the import **verifies the tarball's SHA-256** against
the vetted hash the repo ships (`engine.tar.gz.sha256`). If it doesn't match
— the upstream Ace Stream build changed since this aceman was released, or the
file is corrupt — it **refuses** the file, says so, and keeps waiting for you
to drop in the matching build. This is why nothing plays with a random engine
tarball: aceman only installs the exact build it was tested against.

**Manual way.** If you'd rather place it yourself:

1. Download it from **https://docs.acestream.net/products/#linux** —
   the **Linux → Ubuntu, amd64 / py3.10** build.
2. Rename it to `engine.tar.gz` and place it in the clone at:

   ```
   ~/Projects/aceman/engine/container/dist/engine.tar.gz
   ```

   From Windows you can reach that folder in Explorer at:

   ```
   \\wsl.localhost\Ubuntu\home\ace\Projects\aceman\engine\container\dist\
   ```

   (paste it into the address bar; drop the file in, named `engine.tar.gz`).

See [`../engine/container/README.md`](../engine/container/README.md) for
how to verify it against the `.sha256`.

## 3. Launch — `run.bat` (or the Desktop shortcut)

Double-click **`run.bat`** (or the **aceman** Desktop icon). It:

- opens a second window with the **live server logs**,
- waits for the server to come up (first launch builds container images —
  can take a few minutes),
- opens the URL in your default Windows browser automatically.

Keep the log window open while you use aceman; close it to stop.

## Play in Windows VLC or mpv (optional)

Prefer your Windows-installed player over browser playback? Use
**`get_url_stream.bat`** — it accepts an Ace Stream id and proxies it to
`aceman` inside WSL, which resolves a playback URL reachable from Windows
and prints it (without launching a Linux player):

```
get_url_stream.bat YOUR_CONTENT_ID
```

(or run it with no argument and it prompts for the id). It copies the URL
to your clipboard and, if it finds VLC or mpv, offers to open it. Otherwise
paste the URL into your player via **Media → Open Network Stream**.

How it works: the script first runs `aceman engine start` in WSL (idempotent
— it starts the engine container if it isn't already running, with the
first-run image build visible), so this path works on its own and does **not**
need the web UI to have been launched first. It then runs `aceman <id>`, which
returns the URL with the WSL guest IP as host and leaves the session running
so your Windows player can consume it. The engine times the session out on
its own when the player goes away.

**Bonus — GPU acceleration.** Because the player runs natively on Windows
(not inside WSL), it uses your **Windows GPU drivers directly**, so
playback is hardware-accelerated as long as those drivers are correctly
installed. This sidesteps the broken GPU/VA-API situation under WSL — it's
the main reason to prefer this path over browser playback for heavy
streams.

## Play on another device — phone/tablet (optional)

Want to play a stream on your phone or tablet (VLC) instead of this PC?
By default WSL is NAT'd behind Windows, so other devices on your LAN
can't reach the engine. **`enable_shared_networking.bat`** switches WSL
to **mirrored networking**, which makes the WSL guest share your
Windows network interfaces — so the engine becomes reachable on your
real LAN IP.

```
enable_shared_networking.bat
```

It does two things, then restarts WSL so they take effect:

1. Writes `networkingMode=mirrored` **and** `hostAddressLoopback=true` to
   `%UserProfile%\.wslconfig` (per-user, a one-time backup is saved as
   `.wslconfig.aceman-backup`). The loopback line keeps
   `http://localhost:8770/` — the web UI `run.bat` opens — reachable from
   Windows; mirrored mode drops that automatic forwarding, so without it the
   browser opens to a page that never loads.
2. Opens **TCP port 6878** (the engine) inbound in Windows firewall. This
   step needs admin, so it pops **one UAC prompt** — approve it. Without
   the firewall rule, mirrored networking alone still leaves the phone
   timing out.

Then in the web UI, tick **"Expose engine on local network"** and scan the
QR from your device — it now shows your real LAN IP. Only 6878 is opened;
the web UI port (8770) is left closed, since the phone plays via VLC and
never needs it.

> **Requires Windows 11 22H2 (build 22621) or newer** — mirrored
> networking is ignored on older builds. The script warns you if so.

> **Security:** with this on, the engine is reachable by **any device
> on your LAN** once you tick "Expose engine on local network". aceman
> still blocks web-browser drive-by requests, but the engine has **no
> password** — only enable this on a network you trust, never on public
> or shared Wi-Fi.

To turn it back off, run **`disable_shared_networking.bat`** — it removes
the `networkingMode` and `hostAddressLoopback` lines, closes port 6878 (one
UAC prompt), and restarts WSL, putting you back on default (NAT) networking.

`install.bat` offers the enable step as a prompt during setup; running
the scripts yourself later does exactly the same thing.

## `acestream://` click-to-play (optional)

Want `acestream://` links to *just play* when clicked — including the
**Play** links in the aceman web UI? Register the handler once:

```
internal\register-handler.bat
```

It registers a per-user Windows protocol handler (no admin needed) that
routes `acestream://<id>` clicks to `get_url_stream.bat`, which resolves
the stream and opens it in your Windows VLC/mpv (GPU-accelerated). To
remove it: `internal\unregister-handler.bat` (uninstall does this too).

**Requires VLC or mpv on Windows** — there's nothing to play into
otherwise, so registration is refused with a clear message if neither is
found. Note: the handler stores this folder's path, so if you move the
kit, re-run `register-handler.bat`.

## Stop everything — `stop.bat`

**`stop.bat`** gracefully stops the web + engine containers and then runs
`wsl --shutdown`, so nothing aceman-related is left running.

## Update — `update.bat`

Force-updates the WSL project: fetches GitHub and **hard-resets** the clone
to the latest code (local repo edits are discarded — your favourites live
outside the repo in `~/.config/aceman`, so they're kept). Read the trust
note it prints first.

Pass a branch name to update to something other than `main`, e.g. to try a
feature branch:

```
update.bat some-branch
```

With no argument it updates the branch the clone is currently on (or `main`).
On Linux the same job is `./update.sh [branch]` in the repo root.

## Back up / restore favourites — `backup_to_downloads.bat` / `restore_from_downloads.bat`

**`backup_to_downloads.bat`** saves your aceman favourites (and prefs) from
inside WSL into your Windows **Downloads** folder, as a timestamped
`aceman-backup-…` folder. Run it any time; `uninstall.bat` also **offers**
it before deleting anything.

**`restore_from_downloads.bat`** is the reverse — it copies a backup folder
back into `~/.config/aceman/` in WSL. With no argument it restores the
newest `aceman-backup-…` in Downloads. Stop aceman (close the web UI) before
restoring, then relaunch to see the favourites.

## Uninstall — `uninstall.bat`

Unregisters the Ubuntu distro (deletes everything in it) and removes the
WSL app. Confirms before doing anything, and **offers to back up your
favourites to Downloads first** (via `backup_to_downloads.bat`).

## Files in this kit

The ones you actually run:

| File                 | What                                                        |
|----------------------|-------------------------------------------------------------|
| `install.bat`        | Install WSL + Ubuntu, provision, create the Desktop shortcut |
| `run.bat`            | Launch aceman_web and auto-open the browser                 |
| `import_engine.bat`  | Install the engine tarball from Downloads (waits if missing) |
| `get_url_stream.bat` | Resolve an Ace Stream id to a URL for Windows VLC/mpv        |
| `enable_shared_networking.bat`  | Switch WSL to mirrored networking (play on another device) |
| `disable_shared_networking.bat` | Revert WSL to default (NAT) networking          |
| `backup_to_downloads.bat` | Save favourites to your Windows Downloads              |
| `restore_from_downloads.bat` | Restore favourites from a Downloads backup         |
| `stop.bat`           | Stop aceman containers and shut down WSL                     |
| `update.bat`         | Force-update the project inside WSL (optional branch arg)    |
| `uninstall.bat`      | Remove the distro + WSL (offers a favourites backup first)  |

`internal/` holds bits used by `install.bat` and the optional handler —
mostly no need to touch them: `setup.sh` (Linux provisioning),
`shortcut.bat` (Desktop-shortcut creator, also runnable on its own),
`aceman.ico` (the shortcut icon), and `register-handler.bat` /
`unregister-handler.bat` (the optional `acestream://` click-to-play
handler — see above).
