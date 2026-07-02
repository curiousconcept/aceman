#!/usr/bin/env bash
# Update aceman — counterpart to wsl/update.bat.
# Force-updates the guest clone: fetches GitHub and hard-resets to the latest
# code via update.sh (so a dirty or diverged tree can't dead-end the update).
# Takes an optional branch argument, forwarded to update.sh.
set -euo pipefail

BRANCH="${1:-}"

cat <<EOF
============================================================
 Update aceman
------------------------------------------------------------
 Force-updates the guest clone (~/Projects/aceman): fetches
 GitHub and hard-resets to the latest code. Any local edits to
 the repo are discarded. Your favourites are NOT in the repo
 (they live in the guest's ~/.config/aceman), so they are kept.
 Target branch: ${BRANCH:-current (or main)}

 TRUST NOTE: this pulls code from the internet that will run
 on your machine on the next launch. Only proceed if you trust
 the project author and have reviewed the repository:

     https://github.com/curiousconcept/aceman
============================================================
EOF

read -r -p "Update now (discards local repo edits)? [Y/N] " a
case "$a" in
    [Yy]*) ;;
    *) echo "Cancelled. Nothing changed."; exit 0 ;;
esac

echo
echo "Updating..."
if limactl shell aceman -- bash -lc "cd ~/Projects/aceman && ./update.sh $(printf '%q' "$BRANCH")"; then
    echo "Update complete. Launch with run.command."
else
    echo "Update did not complete cleanly. Check your internet connection, or"
    echo "that the branch name is correct. Open the guest and look:"
    echo "    limactl shell aceman -- bash -lc 'cd ~/Projects/aceman && git status'"
fi
