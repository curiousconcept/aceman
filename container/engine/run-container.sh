#!/usr/bin/env bash
# Run the acestream engine in a rootless Podman container with a
# restricted profile: no caps, no privileges, memory cap, loopback-only
# port. P2P egress only by default — no inbound port mapping unless
# ACE_P2P_PORT is set.
#
# Knobs (env vars, all optional):
#   ACE_IMAGE        container image tag       (default localhost/acestream:vetted)
#   ACE_NAME         container name            (default ace)
#   ACE_API_PORT     host port for HTTP API    (default 6878; alias: ACE_PORT)
#                    forwarded to container    Engine inside *always* binds
#                    port 6878                 6878 — not configurable via
#                                               any engine flag (verified).
#   ACE_API_HOST     bind address for the      (default 127.0.0.1, EXCEPT under
#                    host-side port            WSL where we default to 0.0.0.0
#                                               so Windows VLC can reach the
#                                               engine via the WSL guest IP).
#                                               Override with 127.0.0.1 to
#                                               force loopback-only even on WSL.
#   ACE_P2P_PORT     host port to publish for  (default unset = closed; opt-in)
#                    inbound P2P swarm. Engine
#                    binds 8621 internally
#                    (hardcoded); ACE_P2P_PORT
#                    controls the host port
#                    podman binds.  See README
#                    for router-forwarding
#                    guidance.  Trade-off:
#                    opening this widens the
#                    engine container's attack
#                    surface from outbound-only
#                    to receiving unsolicited
#                    swarm packets. Container
#                    hardening (cap-drop=all,
#                    read-only, no-new-privs,
#                    shared-net isolation)
#                    still applies.
#
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

# Shared helpers — WSL detection, port validation, network ensure.
# Loading this also makes `ensure_shared_network` available so the
# engine joins the same bridge as the web container.
_SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROG="run-container.sh"
. "$_SCRIPT_DIR/../lib.sh"
ACE_NETWORK="${ACE_NETWORK:-aceman-net}"
ensure_shared_network

IMAGE="${ACE_IMAGE:-localhost/acestream:vetted}"
NAME="${ACE_NAME:-ace}"
# ACE_PORT is the old name — accept it as a fallback for callers that
# haven't been updated yet.
API_PORT="${ACE_API_PORT:-${ACE_PORT:-6878}}"
MEMORY="${ACE_MEMORY:-5g}"
CACHE_SIZE="${ACE_CACHE_SIZE:-3g}"

# Bind-host default: loopback everywhere except WSL.
#
# Under WSL, the engine has to be reachable on the WSL guest IP so a
# Windows-side player (VLC over the URL printed by `aceman` under
# auto-WSL mode) can connect. 127.0.0.1 inside WSL2 isn't routable
# from Windows, so the default flips to 0.0.0.0 there. Override
# either with ACE_API_HOST=127.0.0.1 (loopback only) or with
# ACE_DISABLE_WSL=1 (treat WSL as plain Linux — also flips aceman
# and aceman_web back to non-WSL behaviour).
#
# Outside WSL the default stays 127.0.0.1 — keeping the engine
# unreachable from any external interface is the project's whole
# threat-model premise; we never widen by accident.
if is_wsl && [ "${ACE_DISABLE_WSL:-0}" != 1 ]; then
    API_HOST="${ACE_API_HOST:-0.0.0.0}"
else
    API_HOST="${ACE_API_HOST:-127.0.0.1}"
fi

# Validate the port-ish int so a typo doesn't reach podman as a confusing
# message three layers down.
validate_port "$API_PORT" "ACE_API_PORT"

# Validate the bind-host as either 0.0.0.0 or a single IPv4. Reject
# arbitrary hostnames so a stray DNS entry can't quietly point at a
# different interface than the operator expected.
case "$API_HOST" in
    0.0.0.0|127.0.0.1|::1) ;;
    [0-9]*\.[0-9]*\.[0-9]*\.[0-9]*) ;;
    *) echo "run-container.sh: ACE_API_HOST must be an IPv4 (or ::1), got: $API_HOST" >&2; exit 1 ;;
esac

# Optional inbound P2P swarm port. Default: closed. Container side is
# 8621 (engine hardcodes its swarm bind to 8621). The user picks the
# host-side port via ACE_P2P_PORT; for the announcement <-> NAT chain
# to actually work, that should be 8621 too (the engine announces
# 8621 to the swarm; peers won't try a different external port). See
# the header for the threat-model trade-off.
P2P_PORT_FLAGS=()
if [ -n "${ACE_P2P_PORT:-}" ]; then
    validate_port "$ACE_P2P_PORT" "ACE_P2P_PORT"
    P2P_PORT_FLAGS=(
        -p "${API_HOST}:${ACE_P2P_PORT}:8621/tcp"
        -p "${API_HOST}:${ACE_P2P_PORT}:8621/udp"
    )
fi

# Convert a podman-style size ("3g" / "512m" / "1024k" / bare bytes) to
# bytes for the engine's --disk-cache-limit. The engine wants raw bytes.
validate_size_spec "$CACHE_SIZE" "ACE_CACHE_SIZE"
size_to_bytes() {
    local s="${1,,}"
    case "$s" in
        *g) printf '%d' "$(( ${s%g} * 1024 * 1024 * 1024 ))" ;;
        *m) printf '%d' "$(( ${s%m} * 1024 * 1024 ))" ;;
        *k) printf '%d' "$(( ${s%k} * 1024 ))" ;;
        *)  printf '%d' "$s" ;;  # validated above as digits-only
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

# Telemetry / statistics endpoints. DEFAULT: ALLOWED (reachable), so the
# engine behaves as Ace Stream's User Agreement expects — it requires
# unhindered access to its stats/ad facilities. Opt in to blocking by
# exporting ACE_BLOCK_TELEMETRY=1 before launch, which null-routes those
# hosts. That hardens privacy but may conflict with Ace Stream's terms;
# enabling it is the user's explicit, deliberate choice — not the default.
telemetry_block_flags=()
if [ "${ACE_BLOCK_TELEMETRY:-0}" = "1" ]; then
    echo "run-container.sh: ACE_BLOCK_TELEMETRY=1 — blocking Ace Stream telemetry/stats hosts (stats/awstats.acestream.{net,media} null-routed)" >&2
    telemetry_block_flags=(
        --add-host stats.acestream.net:0.0.0.0     --add-host stats.acestream.net:::
        --add-host stats.acestream.media:0.0.0.0   --add-host stats.acestream.media:::
        --add-host awstats.acestream.net:0.0.0.0   --add-host awstats.acestream.net:::
        --add-host awstats.acestream.media:0.0.0.0 --add-host awstats.acestream.media:::
    )
fi

# Args after "$IMAGE" are appended to the image's ENTRYPOINT (set in
# Containerfile to: start-engine --client-console --bind-all
# --disable-sentry), so we only specify the additions here.
exec podman run --rm "${detach_flag[@]}" \
    --name "$NAME" \
    --network "$ACE_NETWORK" \
    -p "${API_HOST}:${API_PORT}:6878" \
    "${P2P_PORT_FLAGS[@]}" \
    --cap-drop=ALL \
    --security-opt no-new-privileges \
    --read-only \
    --tmpfs /tmp:rw,size=64m,mode=1777 \
    --tmpfs "/home/ace/.ACEStream:rw,size=${CACHE_SIZE},mode=1777" \
    --memory "$MEMORY" \
    --pids-limit 768 \
    "${telemetry_block_flags[@]}" \
    "$IMAGE" \
        --disk-cache-limit "$DISK_CACHE_LIMIT" \
        --memory-cache-limit "$MEMORY_CACHE_LIMIT" \
        "$@"
