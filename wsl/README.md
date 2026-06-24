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

## 1. Install — `install.bat`

Double-click **`install.bat`** and approve the UAC prompts. It:

1. Enables WSL, reboots (asks first — make sure WiFi auto-connects at
   startup, since the next phase downloads packages).
2. After reboot, auto-installs Ubuntu and provisions it: creates user
   `ace`, installs `podman git jq`, enables systemd (so `podman stats`
   reports memory), and clones the repo to `~/Projects/aceman`.
3. Creates an **aceman** shortcut on your Desktop.

## 2. Provide the engine tarball (one-time, required to play)

The Ace Stream engine tarball isn't shipped in the repo (it's
proprietary). The web UI runs without it, but **playback needs it**.

1. Download it from **https://docs.acestream.net/products/#linux** —
   the **Linux → Ubuntu, amd64 / py3.10** build.
2. Rename it to `engine.tar.gz` and place it in the clone at:

   ```
   ~/Projects/aceman/container/engine/dist/engine.tar.gz
   ```

   From Windows you can reach that folder in Explorer at:

   ```
   \\wsl.localhost\Ubuntu\home\ace\Projects\aceman\container\engine\dist\
   ```

   (paste it into the address bar; drop the file in, named `engine.tar.gz`).

See [`../container/engine/README.md`](../container/engine/README.md) for
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

How it works: in WSL, `aceman <id>` starts the engine if needed, returns
the URL with the WSL guest IP as host, and leaves the session running so
your Windows player can consume it. The engine times the session out on
its own when the player goes away.

## Stop everything — `stop.bat`

**`stop.bat`** gracefully stops the web + engine containers and then runs
`wsl --shutdown`, so nothing aceman-related is left running.

## Update — `update.bat`

Runs `git pull` inside `~/Projects/aceman`. Read the trust note it prints
first.

## Uninstall — `uninstall.bat`

Unregisters the Ubuntu distro (deletes everything in it) and removes the
WSL app. Confirms before doing anything.

## Files in this kit

| File           | What                                                        |
|----------------|------------------------------------------------------------|
| `install.bat`        | Install WSL + Ubuntu, provision, create the Desktop shortcut |
| `setup.sh`           | Linux provisioning (run automatically by `install.bat`)     |
| `run.bat`            | Launch aceman_web and auto-open the browser                 |
| `get_url_stream.bat` | Resolve an Ace Stream id to a URL for Windows VLC/mpv        |
| `stop.bat`           | Stop aceman containers and shut down WSL                     |
| `shortcut.bat`       | Create the Desktop shortcut (also called by `install.bat`)  |
| `update.bat`         | `git pull` the project inside WSL                           |
| `uninstall.bat`      | Remove the distro + WSL                                     |
| `aceman.ico`         | Shortcut icon                                               |
