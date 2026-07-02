#!/usr/bin/env bash
# Resolve an Ace Stream id to a playback URL for a NATIVE macOS player
# (IINA/VLC) — counterpart to wsl/get_url_stream.bat.
#
# The player runs on macOS, so it decodes through VideoToolbox on the
# real GPU — this is the way to get hardware-accelerated playback on a
# Mac (the in-browser path transcodes on CPU, same as WSL).
#
# Arg 1 = Ace Stream id or acestream:// URL (prompted if absent).
# Arg 2 = "auto" -> launch without prompting (used by the handler app).
set -euo pipefail

ACEID="${1:-}"
MODE="${2:-}"
if [ -z "$ACEID" ]; then
    read -r -p "Enter Ace Stream id (40-hex or acestream://...): " ACEID
fi
[ -n "$ACEID" ] || { echo "No id given."; exit 1; }

# Two steps, so this path is self-contained and does NOT need the web UI
# to have brought the engine up first:
#   1. `aceman engine start` — idempotent; starts the engine container if
#      it isn't running. Output stays visible so the first-run image
#      build (~2 min) doesn't look like a hang. ACE_API_HOST=0.0.0.0 so
#      the engine's API port (6878) binds all interfaces and Lima
#      forwards it to macOS localhost.
#   2. `aceman <id>` — resolves the id and prints a playback URL. Its
#      127.0.0.1:6878 host is reachable here because Lima forwards 6878.
echo "Starting the Ace Stream engine if needed (first run builds the image, ~2 min)..."
if ! limactl shell aceman -- bash -lc 'cd ~/Projects/aceman && ACE_API_HOST=0.0.0.0 ./aceman engine start'; then
    echo "Could not start the engine. Is engine.tar.gz placed and podman working in the guest?" >&2
    exit 1
fi

echo "Resolving stream URL..."
OUT="$(limactl shell aceman -- bash -lc "cd ~/Projects/aceman && ./aceman $(printf '%q' "$ACEID")" 2>/dev/null || true)"
URL="$(printf '%s\n' "$OUT" | grep -oE 'http://[^[:space:]]+' | tail -1 || true)"
[ -n "$URL" ] || { echo "Could not resolve a stream URL. Check the id is valid." >&2; exit 1; }

printf '%s' "$URL" | pbcopy
echo
echo "Stream URL (copied to clipboard):"
echo "  $URL"

# Prefer IINA, then VLC.
PLAYER=""
for app in IINA VLC; do
    if [ -d "/Applications/$app.app" ] || [ -d "$HOME/Applications/$app.app" ]; then
        PLAYER="$app"; break
    fi
done

echo
if [ -n "$PLAYER" ]; then
    if [ "$MODE" = auto ]; then
        echo "Opening in $PLAYER..."
        open -a "$PLAYER" "$URL"
    else
        read -r -p "Open in $PLAYER now? [Y/N] " a
        case "$a" in [Yy]*) open -a "$PLAYER" "$URL" ;; esac
    fi
else
    echo "No IINA/VLC found. Paste the URL into your player (Open Network Stream)."
fi
