#!/usr/bin/env bash
# backup_to_downloads.command — save aceman favourites to your Mac Downloads
# before uninstalling. Counterpart to wsl/backup_to_downloads.bat. Runs
# backup_to_downloads.sh inside the Lima guest, pointed at your Mac Downloads:
# the favourites live in the guest (~/.config/aceman), but Downloads is on
# macOS, which lima.yaml mounts writable into the guest at the same path.
# uninstall.command calls this (prompted); also runnable on its own.
set -euo pipefail

DL="$HOME/Downloads"
limactl shell aceman -- bash -lc "cd ~/Projects/aceman && ACE_DOWNLOADS='$DL' ./backup_to_downloads.sh"

# Any arg (uninstall.command passes "nopause") skips the prompt so the caller
# keeps control; a plain double-click waits so the result stays on screen.
if [ -z "${1:-}" ]; then
    echo
    read -r -p "Press Enter to close." _
fi
