#!/usr/bin/env bash
# Remove the acestream:// handler app.
# Counterpart to wsl/internal/unregister-handler.bat.
set -euo pipefail
SILENT="${1:-}"

DEST="$HOME/Applications/aceman-handler.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if [ -d "$DEST" ]; then
    "$LSREGISTER" -u "$DEST" 2>/dev/null || true
    rm -rf "$DEST"
    echo "Removed the acestream:// handler."
else
    echo "No handler installed."
fi

[ "$SILENT" = silent ] || read -r -p "Press Enter to close..." _
