#!/usr/bin/env bash
# Stop aceman and the Lima guest — counterpart to wsl/stop.bat.
set -euo pipefail

echo "Stopping aceman (web + engine) and the Lima guest..."

# Graceful first: ask the web to shut down and stop the engine container.
# (Both run with --rm, so stopping the VM would drop them anyway, but a
# clean stop lets the web post /api/shutdown and the engine exit nicely.)
limactl shell aceman -- bash -lc \
    'cd ~/Projects/aceman && ./aceman_web --stop 2>/dev/null; podman stop ace 2>/dev/null; true' \
    2>/dev/null || true

limactl stop aceman 2>/dev/null || true

echo
echo "Done. aceman containers stopped and the Lima guest is shut down."
