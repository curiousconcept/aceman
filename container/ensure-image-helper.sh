#!/usr/bin/env bash
# ensure-image-helper.sh — thin CLI shim around the lib.sh
# ensure_engine_image / ensure_web_image helpers.
#
# Used by the broker's web.restart / engine.restart actions so they
# can run the same build-if-stale check the launcher wrapper does
# without sourcing bash into Python. Exits 0 on success (image is
# now up to date), non-zero on failure with a message on stderr.
#
# Usage:
#   container/ensure-image-helper.sh engine
#   container/ensure-image-helper.sh web
#
# Honors ACE_COMMIT just like the wrappers — if the broker was
# spawned in a session that pinned the build via `aceman_web
# --commit <sha>`, that env is still present here and the helper
# rebuilds at the same commit.

set -e
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ACELIB_PROJECT_ROOT="${ACELIB_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PROG="${PROG:-aceman-broker}"
. "$SCRIPT_DIR/lib.sh"

case "${1:-}" in
    engine) ensure_engine_image ;;
    web)    ensure_web_image ;;
    *) echo "usage: $0 engine|web" >&2; exit 2 ;;
esac
