#!/usr/bin/env bash
# tail-engine.sh — follow the Ace Stream engine container's stdout/stderr.
#
# The engine runs in a rootless podman container (default name: `ace`).
# `podman logs -f` works with --rm containers too, so this stays useful
# whether the engine was started via `aceman engine start`, via the
# broker, or via `container/engine/run-container.sh` directly.

set -e
NAME="${ACE_NAME:-ace}"

if ! command -v podman >/dev/null; then
    echo "tail-engine: podman not on PATH" >&2
    exit 1
fi

if ! podman ps --filter "name=^${NAME}$" --format '{{.Names}}' \
        | grep -qx "$NAME"; then
    echo "tail-engine: container '$NAME' is not running." >&2
    echo "tail-engine: start it with: ./aceman engine start" >&2
    echo "tail-engine: (or set ACE_NAME=<name> if you used a different one)" >&2
    exit 1
fi

# --tail 200 shows recent history first; -f keeps following. Engine
# log volume is modest, no risk of flooding.
exec podman logs --tail 200 -f "$NAME"
