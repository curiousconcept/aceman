#!/usr/bin/env bash
# Update aceman — counterpart to wsl/update.bat.
# Runs `git pull` inside the Lima guest (~/Projects/aceman).
set -euo pipefail

cat <<'EOF'
============================================================
 Update aceman
------------------------------------------------------------
 Runs 'git pull' inside the Lima guest (~/Projects/aceman)
 to fetch the latest code from GitHub.

 TRUST NOTE: this pulls code from the internet that will run
 on your machine on the next launch. Only proceed if you trust
 the project author and have reviewed the repository:

     https://github.com/curiousconcept/aceman
============================================================
EOF

read -r -p "Pull the latest code now? [Y/N] " a
case "$a" in
    [Yy]*) ;;
    *) echo "Cancelled. Nothing changed."; exit 0 ;;
esac

echo
echo "Pulling..."
if limactl shell aceman -- bash -lc 'cd ~/Projects/aceman && git pull --ff-only'; then
    echo "Update complete. Launch with run.command."
else
    echo "git pull did not complete cleanly. You may have local changes or a"
    echo "diverged branch. Open the guest and check:"
    echo "    limactl shell aceman -- bash -lc 'cd ~/Projects/aceman && git status'"
fi
