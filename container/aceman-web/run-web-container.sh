#!/usr/bin/env bash
# run-web-container.sh — build (idempotent) + run the aceman web
# frontend in a rootless podman container.
#
# Called by `aceman_web` when ACE_WEB_CONTAINER=1 or `--container`
# is passed. Mirrors run-container.sh's posture: rootless, no extra
# caps, no privileged flags, loopback-only port forward, USER NS
# kept-id so mounted host dirs work with the user's uid.
#
# Networking choice: bridge (default), NOT --network=host. Reasons:
#   * Same blast-radius story as the engine container — host network
#     namespace is one fewer isolation boundary, and we don't need it.
#   * The only host services this container talks to are (a) the
#     acestream engine HTTP at 127.0.0.1:6878 on the host, and (b)
#     the broker UNIX socket. The socket is mounted as a file; the
#     engine is reached via --add-host host.containers.internal:host-gateway,
#     which gives us a stable hostname pointing at the host's bridge IP.
#     The python is launched with --engine http://host.containers.internal:6878
#     so that resolution flows naturally.
#
# Knobs (env vars, all optional):
#   ACE_WEB_IMAGE      image tag             (default localhost/aceman-web:vetted)
#   ACE_WEB_NAME       container name        (default aceman-web)
#   ACE_WEB_PORT       host port to publish  (default 8770)
#   ACE_WEB_HOST       host bind address     (default 127.0.0.1)
#   ACE_ENGINE         engine URL the web hits (default http://host.containers.internal:6878)
#   ACE_DETACH         podman run -d if set  (default off — foreground)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# This script lives under container/aceman-web/, so the project root
# is two levels up.
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ACE_WEB_IMAGE="${ACE_WEB_IMAGE:-localhost/aceman-web:vetted}"
ACE_WEB_NAME="${ACE_WEB_NAME:-aceman-web}"
ACE_WEB_PORT="${ACE_WEB_PORT:-8770}"
ACE_WEB_HOST="${ACE_WEB_HOST:-127.0.0.1}"
ACE_ENGINE="${ACE_ENGINE:-http://host.containers.internal:6878}"

command -v podman >/dev/null || { echo "podman not installed"; exit 1; }

# Build only when the image doesn't already exist. Rebuild manually
# with: podman build -t "$ACE_WEB_IMAGE" \
#       -f container/aceman-web/Containerfile.web .
if ! podman image exists "$ACE_WEB_IMAGE"; then
    echo "building $ACE_WEB_IMAGE ..."
    podman build -t "$ACE_WEB_IMAGE" \
        -f "$SCRIPT_DIR/Containerfile.web" "$PROJECT_ROOT"
fi

# IMPORTANT: only mount the aceman-owned *subdirectories*, never the
# whole XDG roots. Mounting $HOME/.config (etc) into the container
# would expose every other app's data (Firefox profile, gnome-keyring
# secrets, ssh config, ...) — read/write — to a process the user can't
# fully audit. Narrowing to aceman/ keeps blast radius to OUR data
# only, matching the engine container's posture.
#
# DATA_HOME is intentionally NOT mounted at all. Desktop-entry writes
# (~/.local/share/applications/aceman.desktop) are done by the host
# broker, not by the containerised web — there's nothing here the
# container needs to see.
CONFIG_DIR_HOST="${XDG_CONFIG_HOME:-$HOME/.config}/aceman"
CACHE_DIR_HOST="${XDG_CACHE_HOME:-$HOME/.cache}/aceman"
RUNTIME_DIR_HOST="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/aceman"
mkdir -p "$CONFIG_DIR_HOST" "$CACHE_DIR_HOST" "$RUNTIME_DIR_HOST"

# Inside the container we put each mount at a known fixed path
# (instead of preserving the host's $HOME/... layout) so the
# python's XDG_*_HOME envs resolve to dirs that contain *only* the
# mounted aceman subdir — there is no "outside" to escape to.
CONFIG_DIR_CTR=/xdg/config/aceman
CACHE_DIR_CTR=/xdg/cache/aceman
RUNTIME_DIR_CTR=/xdg/runtime/aceman

# If a previous container with the same name is still around (left
# over from a crash / unclean shutdown), remove it. --rm on `podman
# run` only fires on a clean exit.
if podman container exists "$ACE_WEB_NAME" 2>/dev/null; then
    podman rm -f "$ACE_WEB_NAME" >/dev/null 2>&1 || true
fi

DETACH_FLAG=""
[ -n "${ACE_DETACH:-}" ] && DETACH_FLAG="-d"

# --userns=keep-id maps the in-container uid to the host's user so
# files written under the mounted dirs are owned by the user, not
# subuid-mapped root. --cap-drop=all + --security-opt=no-new-privileges
# match the engine container's hardening. --read-only marks the
# container's rootfs read-only; the four mounts below are explicitly
# the only writable areas (and only to our own data).
exec podman run --rm $DETACH_FLAG -i \
    --name "$ACE_WEB_NAME" \
    --userns=keep-id \
    --cap-drop=all \
    --security-opt=no-new-privileges \
    --read-only --tmpfs /tmp:rw,size=64m,mode=1777 \
    --add-host host.containers.internal:host-gateway \
    -p "$ACE_WEB_HOST:$ACE_WEB_PORT:$ACE_WEB_PORT" \
    -e XDG_CONFIG_HOME=/xdg/config \
    -e XDG_CACHE_HOME=/xdg/cache \
    -e XDG_RUNTIME_DIR=/xdg/runtime \
    -e HOME=/xdg \
    -v "$CONFIG_DIR_HOST:$CONFIG_DIR_CTR" \
    -v "$CACHE_DIR_HOST:$CACHE_DIR_CTR" \
    -v "$RUNTIME_DIR_HOST:$RUNTIME_DIR_CTR" \
    "$ACE_WEB_IMAGE" \
    python3 web/aceman_web.py \
        --host 0.0.0.0 \
        --port "$ACE_WEB_PORT" \
        --engine "$ACE_ENGINE" \
        "$@"
