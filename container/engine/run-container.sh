#!/usr/bin/env bash
# Run the acestream engine in a rootless Podman container with a
# restricted profile: no caps, no privileges, memory cap, loopback-only
# port. P2P egress only — no inbound port mapping.
#
# Knobs (env vars, all optional):
#   ACE_IMAGE        container image tag       (default localhost/acestream:vetted)
#   ACE_NAME         container name            (default ace)
#   ACE_API_PORT     host port for HTTP API    (default 6878; alias: ACE_PORT)
#                    forwarded to container    Engine inside *always* binds
#                    port 6878                 6878 — not configurable via
#                                               any engine flag (verified).
#
# The engine's P2P swarm port (8621 TCP+UDP) is also hardcoded and is
# deliberately *not* published — the swarm sees only outbound connections
# from the container. Inbound P2P would require a VPN sidecar (e.g.
# Gluetun) sharing its netns, which would handle ports itself.
#   ACE_MEMORY       podman --memory value     (default 5g)
#   ACE_CACHE_SIZE   tmpfs size for engine     (default 3g; was 2g — bumped
#                    cache dir; passed to       so a single live stream's
#                    --tmpfs)                   chunks don't blow it out)
#   ACE_DETACH=1     run with -d (background)  — used by aceman autostart
#
# Any positional args to this script are forwarded as extra engine flags
# (e.g. --download-limit 2000, --max-peers 50). Useful for one-off tuning
# without editing this file.

set -euo pipefail

IMAGE="${ACE_IMAGE:-localhost/acestream:vetted}"
NAME="${ACE_NAME:-ace}"
# ACE_PORT is the old name — accept it as a fallback for callers that
# haven't been updated yet.
API_PORT="${ACE_API_PORT:-${ACE_PORT:-6878}}"
MEMORY="${ACE_MEMORY:-5g}"
CACHE_SIZE="${ACE_CACHE_SIZE:-3g}"

# Validate the port-ish int so a typo doesn't reach podman as a confusing
# message three layers down.
case "$API_PORT" in
    ''|*[!0-9]*) echo "run-container.sh: ACE_API_PORT must be an integer: $API_PORT" >&2; exit 1 ;;
esac

# Convert a podman-style size ("3g" / "512m" / "1024k" / bare bytes) to
# bytes for the engine's --disk-cache-limit. The engine wants raw bytes.
size_to_bytes() {
    local s="${1,,}"
    case "$s" in
        *g) printf '%d' "$(( ${s%g} * 1024 * 1024 * 1024 ))" ;;
        *m) printf '%d' "$(( ${s%m} * 1024 * 1024 ))" ;;
        *k) printf '%d' "$(( ${s%k} * 1024 ))" ;;
        ''|*[!0-9]*) echo "run-container.sh: invalid size: $1" >&2; exit 1 ;;
        *)  printf '%d' "$s" ;;
    esac
}
CACHE_BYTES="$(size_to_bytes "$CACHE_SIZE")"
# Engine self-cap at 90% of the tmpfs so it starts evicting before any
# chunk write would hit ENOSPC. Without this, the tmpfs just fills until
# every new /ace/getstream returns "[Errno 28] No space left on device".
DISK_CACHE_LIMIT="$(( CACHE_BYTES * 9 / 10 ))"
# Keep the engine's in-RAM cache bounded so its RSS doesn't drift up and
# eat the slack between (engine anon + tmpfs) and --memory. 256 MiB is
# enough for live buffering without crowding the tmpfs accounting.
MEMORY_CACHE_LIMIT="$(( 256 * 1024 * 1024 ))"

# Replace any prior instance.
podman rm -f "$NAME" >/dev/null 2>&1 || true

# ACE_DETACH=1 runs the engine in the background and returns immediately.
# Used by aceman when it needs to start the engine on demand.
detach_flag=()
[ "${ACE_DETACH:-0}" = "1" ] && detach_flag=(-d)

# Args after "$IMAGE" are appended to the image's ENTRYPOINT (set in
# Containerfile to: start-engine --client-console --bind-all
# --disable-sentry), so we only specify the additions here.
exec podman run --rm "${detach_flag[@]}" \
    --name "$NAME" \
    -p "127.0.0.1:${API_PORT}:6878" \
    --cap-drop=ALL \
    --security-opt no-new-privileges \
    --read-only \
    --tmpfs /tmp:rw,size=64m,mode=1777 \
    --tmpfs "/home/ace/.ACEStream:rw,size=${CACHE_SIZE},mode=1777" \
    --memory "$MEMORY" \
    --pids-limit 768 \
    --add-host stats.acestream.net:0.0.0.0     --add-host stats.acestream.net::: \
    --add-host stats.acestream.media:0.0.0.0   --add-host stats.acestream.media::: \
    --add-host awstats.acestream.net:0.0.0.0   --add-host awstats.acestream.net::: \
    --add-host awstats.acestream.media:0.0.0.0 --add-host awstats.acestream.media::: \
    "$IMAGE" \
        --disk-cache-limit "$DISK_CACHE_LIMIT" \
        --memory-cache-limit "$MEMORY_CACHE_LIMIT" \
        "$@"
