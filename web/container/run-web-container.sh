#!/usr/bin/env bash
# run-web-container.sh — build (idempotent) + run the aceman web
# frontend in a rootless podman container.
#
# Called by `aceman_web` by default (the wrapper now containerises
# the web frontend out of the box; --native opts back to host python).
# Mirrors run-container.sh's posture: rootless, no extra caps, no
# privileged flags, loopback-only port forward, USER NS kept-id so
# mounted host dirs work with the user's uid.
#
# Networking choice: shared user-defined bridge (aceman-net), NOT
# --network=host. Reasons:
#   * Same blast-radius story as the engine container — host network
#     namespace is one fewer isolation boundary, and we don't need it.
#   * The engine and web both join `aceman-net` (created by
#     ../shared-net.sh) so the web reaches the engine directly by
#     container name (http://$ACE_NAME:6878) over an internal podman
#     bridge. No more host-gateway hop, no `--add-host
#     host.containers.internal:host-gateway` widening the container's
#     view of host services.
#   * The only other host service the web touches is the broker UNIX
#     socket, which is mounted as a file — no network needed at all.
#
# Knobs (env vars, all optional):
#   ACE_WEB_IMAGE      image tag             (default localhost/aceman-web:vetted)
#   ACE_WEB_NAME       container name        (default aceman-web)
#   ACE_WEB_PORT       host port to publish  (default 8770)
#   ACE_WEB_HOST       host bind address     (default 127.0.0.1; 0.0.0.0 under WSL)
#   ACE_NAME           engine container name (default ace — used for DNS)
#   ACE_ENGINE         engine URL the web hits (default http://$ACE_NAME:6878)
#   ACE_NETWORK        shared podman network (default aceman-net)
#   ACE_WEB_MEMORY     podman --memory value (default 1g)
#   ACE_WEB_PIDS       podman --pids-limit   (default 256)
#   ACE_DETACH         podman run -d if set  (default off — foreground)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# This script lives under web/container/, so the project root
# is two levels up.
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Shared helpers (sourced for ensure_shared_network; same file backs
# the engine launcher so both containers stay on the same network).
PROG="run-web-container.sh"
. "$SCRIPT_DIR/../../shared/container/lib.sh"
ACE_NETWORK="${ACE_NETWORK:-aceman-net}"
ensure_shared_network

ACE_WEB_IMAGE="${ACE_WEB_IMAGE:-localhost/aceman-web:vetted}"
ACE_WEB_NAME="${ACE_WEB_NAME:-aceman-web}"
ACE_WEB_PORT="${ACE_WEB_PORT:-8770}"
ACE_WEB_HOST="${ACE_WEB_HOST:-127.0.0.1}"
ACE_NAME="${ACE_NAME:-ace}"
ACE_ENGINE="${ACE_ENGINE:-http://${ACE_NAME}:6878}"
ACE_WEB_MEMORY="${ACE_WEB_MEMORY:-1g}"
ACE_WEB_PIDS="${ACE_WEB_PIDS:-256}"

command -v podman >/dev/null || { echo "podman not installed"; exit 1; }

# Build only when the image doesn't already exist. Rebuild manually
# with: podman build -t "$ACE_WEB_IMAGE" \
#       -f web/container/Containerfile.web .
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

# ACE_DETACH preserved as a "fire and forget" mode (no log follower,
# wrapper returns immediately). Default mode now ALWAYS runs the
# container detached and follows the logs in a separate step, so the
# broker can `podman rm -f` + replay CreateCommand mid-run (to apply
# a rebuild) without orphaning the terminal — the previous
# `exec podman run -i` foreground would exit at that rm and the new
# container's stdio had no consumer, which is what made the terminal
# go silent.
DETACH_REQUESTED=""
[ -n "${ACE_DETACH:-}" ] && DETACH_REQUESTED="1"

# Mounts. Each path is the smallest one the python actually touches:
#   CONFIG  — favorites.db + config.json live here; RW required.
#   CACHE   — web.log (we append) + broker.log (/api/log/... reads it
#             via the host-side broker, so the directory is
#             traversed); RW required.
#   RUNTIME — broker.sock (AF_UNIX). The python connects() to it; the
#             broker on the host is what created the socket. Mounted
#             RW because some kernels treat AF_UNIX connect as
#             needing write on the socket file.
#
# Each `-v` carries `:z`. Podman relabels the host directory to the
# shared SELinux type (container_file_t) so the labelled container can
# read/write at the file-label layer. Without it, opening favorites.db
# fails ("unable to open database file") on Fedora-family distros
# whose user data lives under user_home_t. `:z` (lowercase, shared)
# instead of `:Z` because the host-side broker also writes into these
# dirs and needs to keep working.
#
# Hardening flags below. Read top-to-bottom, ordered so the next
# section's "we keep" list reads naturally.
#
#   --network         the shared user-defined podman bridge. Container
#                     can reach the engine by name, NOT the host's
#                     loopback (no host-gateway add-host).
#   --userns=keep-id  in-container uid maps to host uid, so files
#                     written into mounted dirs are owned by the user
#                     instead of a subuid-mapped phantom.
#   --cap-drop=all    drops every Linux capability. The python doesn't
#                     need to bind low ports, change uids, raw-socket,
#                     mount anything — nothing.
#   --security-opt=no-new-privileges
#                     setuid binaries can't escalate. Even if a setuid
#                     thing ended up on disk (it doesn't, rootfs is
#                     RO), it couldn't gain privs.
#   --security-opt label=disable
#                     TURNS OFF SELinux MAC for this container only.
#                     Why: the python here connects to the host
#                     broker's AF_UNIX socket. The broker runs as
#                     user_t, the container would normally run as
#                     container_t. Default policy on Fedora / RHEL /
#                     CentOS / openSUSE does NOT allow
#                     `container_t connectto user_t :
#                     unix_stream_socket`, so the connect fails with
#                     EACCES regardless of file label or :z relabel.
#                     The alternatives (ship a custom SELinux policy
#                     module per distro; rewrite the broker as a TCP
#                     service with a hand-rolled auth scheme to
#                     replace SO_PEERCRED; move the broker into a
#                     container with full host podman access) each
#                     cost much more than they buy. We still keep
#                     EVERY other layer of defense (see list below).
#                     Crucially, the ENGINE container — the actually
#                     untrusted P2P binary — keeps its SELinux label;
#                     this flag is for the web container only.
#   --read-only       rootfs is RO; only the named tmpfs + the three
#                     bind mounts are writable.
#   --tmpfs /tmp      writable scratch for ffmpeg subprocess /
#                     python tempfile. Capped at 64m so a runaway
#                     can't exhaust host disk.
#   --memory          podman cgroup cap. Caps total RSS at 1g default,
#                     overridable via $ACE_WEB_MEMORY.
#   --pids-limit      cgroup cap on processes; bounds a forkbomb /
#                     runaway-ffmpeg.
#
# What the label=disable line actually costs: the SELinux MAC layer
# is off for this container's processes (they run as spc_t instead of
# container_t). Everything else still applies:
#   * DAC: process runs as your UID, can't read root-owned files.
#   * No Linux capabilities (cap-drop=all).
#   * No new privs (setuid is dead).
#   * Read-only rootfs.
#   * Only three narrow bind mounts visible — not your $HOME, not
#     /etc, nothing else.
#   * Separate PID, mount, network, IPC, UTS, user namespaces.
#   * 1g memory cap / 256 PID cap.
#   * On the podman bridge only, no host-gateway to LAN.
# An RCE in the python here could call the broker (intended), read
# the three mounted dirs (already could via :z), and nothing else.
# It can't escape to spawn host processes, can't read random $HOME
# files, can't reach the engine's data, can't talk to anything on
# the LAN.
# Pass the DRI render node when it exists so ffmpeg can use VA-API for
# GPU encode/scale/deinterlace (GPU Acceleration card). Conditional so
# the container starts cleanly on machines without a render node.
# --device adds only the specific node to the cgroup device whitelist;
# it does NOT require extra capabilities and is safe alongside --cap-drop=all.
DRI_ARGS=()
[ -e /dev/dri/renderD128 ] && DRI_ARGS+=(--device /dev/dri/renderD128)

# NVIDIA (NVENC) needs more than a device node: h264_nvenc loads the host
# driver's libcuda.so.1, which only reaches the container when the GPU is
# injected via CDI (Container Device Interface). Pass nvidia.com/gpu=all when
# the driver control node exists AND a CDI spec is present (generated once with
# `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml`) — the same test
# the broker's nvidia probe uses, so we never pass a device the probe didn't
# advertise. Without CDI the container has no libcuda and NVENC dies with
# "Cannot load libcuda.so.1" (issue #12); we skip it and playback falls back to
# CPU/VA-API.
_cdi_nvidia_spec() {
    local d f
    for d in /etc/cdi /var/run/cdi; do
        for f in "$d"/nvidia*.yaml "$d"/nvidia*.json; do
            [ -e "$f" ] && return 0
        done
    done
    return 1
}
# nvidia's CDI createContainer hook runs ldconfig, which writes
# /etc/ld.so.cache — impossible under a --read-only rootfs. So a GPU container
# gets a writable rootfs; EVERY other isolation flag (cap-drop, no-new-privs,
# userns, memory/pid caps, bridge-only network) is unchanged.
NVIDIA_ARGS=()
READONLY_ARGS=(--read-only)
if [ -e /dev/nvidiactl ] && _cdi_nvidia_spec; then
    NVIDIA_ARGS+=(--device nvidia.com/gpu=all)
    READONLY_ARGS=()
fi

podman run -d --rm \
    --name "$ACE_WEB_NAME" \
    --network "$ACE_NETWORK" \
    --userns=keep-id \
    --cap-drop=all \
    --security-opt=no-new-privileges \
    --security-opt label=disable \
    "${READONLY_ARGS[@]}" --tmpfs /tmp:rw,size=64m,mode=1777 \
    --memory "$ACE_WEB_MEMORY" \
    --pids-limit "$ACE_WEB_PIDS" \
    "${DRI_ARGS[@]}" \
    "${NVIDIA_ARGS[@]}" \
    -p "$ACE_WEB_HOST:$ACE_WEB_PORT:$ACE_WEB_PORT" \
    -e XDG_CONFIG_HOME=/xdg/config \
    -e XDG_CACHE_HOME=/xdg/cache \
    -e XDG_RUNTIME_DIR=/xdg/runtime \
    -e HOME=/xdg \
    -v "$CONFIG_DIR_HOST:$CONFIG_DIR_CTR:z" \
    -v "$CACHE_DIR_HOST:$CACHE_DIR_CTR:z" \
    -v "$RUNTIME_DIR_HOST:$RUNTIME_DIR_CTR:z" \
    "$ACE_WEB_IMAGE" \
    python3 -u web/aceman_web.py \
        --host 0.0.0.0 \
        --port "$ACE_WEB_PORT" \
        --engine "$ACE_ENGINE" \
        "$@" >/dev/null

# Fire-and-forget mode: caller asked for the container in the
# background. Skip the log follower; user is responsible for
# `podman logs -f aceman-web` if they want output.
[ -n "$DETACH_REQUESTED" ] && exit 0

# Ctrl+C / SIGTERM in the wrapper terminal must take the container
# down with us. Otherwise the user hits Ctrl+C, the log follower
# dies, and aceman-web silently keeps running in the background.
_cleanup() {
    podman rm -f "$ACE_WEB_NAME" >/dev/null 2>&1 || true
    exit 0
}
trap _cleanup INT TERM HUP

# Stream container logs to this terminal, with reconnect tolerance
# for the broker's recreate path (`podman rm -f` + replay
# CreateCommand to swap in a fresh image): when the old container
# disappears, give the recreate up to 10 s to land a new one before
# concluding the user actually shut us down externally.
_gone_deadline=0
while true; do
    if podman container exists "$ACE_WEB_NAME" 2>/dev/null; then
        _gone_deadline=0
        podman logs -f "$ACE_WEB_NAME" 2>&1 || true
    else
        _now=$(date +%s)
        [ "$_gone_deadline" = 0 ] && _gone_deadline=$((_now + 10))
        [ "$_now" -ge "$_gone_deadline" ] && break
        sleep 1
    fi
done
