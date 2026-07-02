#!/usr/bin/env bash
# update.sh — refresh the aceman clone to the latest code from GitHub.
#
# Force-pull semantics: fetch the remote, then hard-reset the working tree to
# origin/<branch>. This always lands you exactly on the published code, even if
# a past version left the tree dirty or the branch diverged — the cases where a
# plain `git pull --ff-only` dead-ends. A hard reset is safe here because
# nothing the user cares about lives in the repo: web + CLI favourites live in
# ~/.config/aceman, and engine/container/dist/engine.tar.gz is gitignored, so
# neither is touched by the reset.
#
# Usage: update.sh [branch]
#   branch defaults to the current branch (or main if HEAD is detached).
# wsl/update.bat calls this inside WSL and forwards its optional branch arg.

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$SCRIPT_DIR" || { echo "update: cannot cd to $SCRIPT_DIR" >&2; exit 1; }

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
    BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    { [ -z "$BRANCH" ] || [ "$BRANCH" = HEAD ]; } && BRANCH="main"
fi

echo "update: fetching origin/$BRANCH…"
if ! git fetch origin "$BRANCH"; then
    echo "update: git fetch failed — check your internet connection." >&2
    exit 1
fi

# Drop any local edits to tracked files first, so the switch below can't be
# blocked by a dirty tree; then land the branch exactly on the fetched tip.
git reset --hard
if ! git checkout -B "$BRANCH" "origin/$BRANCH"; then
    echo "update: could not switch to $BRANCH — is 'origin/$BRANCH' a real branch?" >&2
    exit 1
fi

echo "update: now on $BRANCH at $(git rev-parse --short HEAD). Relaunch to pick it up."
