#!/usr/bin/env bash
# import_engine.command — find the Ace Stream engine tarball in your Mac
# Downloads and install it into the guest clone as engine.tar.gz. Counterpart
# to wsl/import_engine.bat. Runs import_engine.sh inside the Lima guest against
# your Mac Downloads (mounted into the guest by lima.yaml). If the tarball
# isn't there yet, the script prints the download URL and WAITS — download it
# in your browser, then press Enter in this window to finish.
set -euo pipefail

DL="$HOME/Downloads"
limactl shell aceman -- bash -lc "cd ~/Projects/aceman && ACE_DOWNLOADS='$DL' ./import_engine.sh"
echo
read -r -p "Press Enter to close." _
