#!/usr/bin/env bash
# aceman macOS launcher — counterpart to wsl/run.bat.
# Launches aceman_web inside the Lima guest in its own Terminal window
# (live logs), waits for the port, then opens your Mac browser.
set -euo pipefail

PORT=8770
URL="http://localhost:$PORT/"

# Truncate the web log so a later read sees THIS run, not a stale one.
limactl shell aceman -- bash -lc 'mkdir -p ~/.cache/aceman; : > ~/.cache/aceman/web.log' 2>/dev/null || true

# Server in its OWN Terminal window = real TTY = live, unbuffered logs.
# --host 0.0.0.0 so Lima forwards the published port to macOS localhost.
# --no-local-desktop so the UI hides Linux-desktop-only affordances (the
# App-launcher card, the native player target) — the user's real desktop
# is macOS, reached via this kit, not the Linux guest. Same UI mode WSL
# uses. The trailing read keeps the window open after the server stops so
# any error stays visible.
osascript <<OSA >/dev/null
tell application "Terminal"
    activate
    do script "limactl shell aceman -- bash -lc 'cd ~/Projects/aceman && ./aceman_web --host 0.0.0.0 --port $PORT --no-local-desktop; echo; echo [server stopped - press Enter to close]; read _'"
end tell
OSA

echo "Waiting for the server (first launch builds images, can take a few minutes)..."
for _ in $(seq 1 120); do
    if curl -fsS -m 2 "$URL" >/dev/null 2>&1; then
        open "$URL"
        echo
        echo "Opened $URL"
        echo "The server keeps running in the other Terminal window. Close it to stop aceman."
        exit 0
    fi
    printf '.'
    sleep 3
done
echo
echo "Timed out waiting for $URL. Check the live-logs Terminal window for errors." >&2
exit 1
