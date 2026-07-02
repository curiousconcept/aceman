#!/usr/bin/env bash
# backup_to_downloads.sh — copy aceman's favourites (and prefs) into your
# Downloads folder, so an uninstall that wipes ~/.config/aceman doesn't take
# them with it. aceman_uninstall calls this (prompted) right before deleting
# the config dir; you can also run it standalone any time.
#
# Saves everything in $XDG_CONFIG_HOME/aceman that holds user data:
#   favorites.db   web favourites (SQLite)
#   favorites      CLI favourites (one per line)
#   config.json    preferences
#   env            user env overrides
# into a timestamped folder in Downloads. Absent files are skipped.
#
# Downloads dir resolution: $ACE_DOWNLOADS (the WSL .bat points this at the
# Windows Downloads folder) → $XDG_DOWNLOAD_DIR → ~/Downloads.

set -u

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/aceman"
DOWNLOADS="${ACE_DOWNLOADS:-${XDG_DOWNLOAD_DIR:-$HOME/Downloads}}"

if [ ! -d "$CONFIG_DIR" ]; then
    echo "backup_to_downloads: nothing to back up — $CONFIG_DIR does not exist."
    exit 0
fi

# Only the files that hold user data; skip anything absent.
present=()
for f in favorites.db favorites config.json env; do
    [ -e "$CONFIG_DIR/$f" ] && present+=("$f")
done
if [ "${#present[@]}" -eq 0 ]; then
    echo "backup_to_downloads: no favourites or prefs in $CONFIG_DIR — nothing to save."
    exit 0
fi

if ! mkdir -p "$DOWNLOADS"; then
    echo "backup_to_downloads: cannot create Downloads dir: $DOWNLOADS" >&2
    exit 1
fi
DEST="$DOWNLOADS/aceman-backup-$(date +%Y%m%d-%H%M%S)"
if ! mkdir -p "$DEST"; then
    echo "backup_to_downloads: cannot create backup dir: $DEST" >&2
    exit 1
fi

for f in "${present[@]}"; do
    # Plain cp (no -p): preserving perms/owner warns on the Windows drvfs
    # mount under WSL, and a backup copy doesn't need them.
    cp "$CONFIG_DIR/$f" "$DEST/" && echo "  saved $f"
done

echo "backup_to_downloads: favourites saved to $DEST"
echo "To restore later: copy these files back into $CONFIG_DIR"
