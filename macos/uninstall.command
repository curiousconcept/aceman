#!/usr/bin/env bash
# aceman macOS uninstaller — counterpart to wsl/uninstall.bat.
# Removes the acestream:// handler and deletes the Lima 'aceman' guest.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== aceman macOS uninstaller ==="
echo
echo "This will:"
echo "  1. Remove the acestream:// handler app (if registered)"
echo "  2. Delete the Lima 'aceman' guest and ALL its files"
echo
echo "*** This permanently deletes everything inside the guest. ***"
echo
read -r -p "Continue? [Y/N] " a
case "$a" in
    [Yy]*) ;;
    *) echo "Aborted. Nothing was changed."; exit 0 ;;
esac

# Remove the protocol handler if present (best-effort).
"$HERE/internal/unregister-handler.command" silent 2>/dev/null || true

echo "Stopping and deleting the Lima guest..."
limactl stop aceman 2>/dev/null || true
limactl delete aceman 2>/dev/null || true

echo
echo "=== Uninstall complete. ==="
echo "Lima itself was left installed. Remove it with:  brew uninstall lima"
