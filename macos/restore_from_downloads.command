#!/usr/bin/env bash
# restore_from_downloads.command — restore aceman favourites from a backup
# folder in your Mac Downloads (made by backup_to_downloads.command) back into
# the guest. Counterpart to wsl/restore_from_downloads.bat. Runs
# restore_from_downloads.sh inside the Lima guest against your Mac Downloads.
# With no argument it restores the newest aceman-backup-* folder there.
set -euo pipefail

DL="$HOME/Downloads"
limactl shell aceman -- bash -lc "cd ~/Projects/aceman && ACE_DOWNLOADS='$DL' ./restore_from_downloads.sh $(printf '%q' "${1:-}")"
echo
read -r -p "Press Enter to close." _
