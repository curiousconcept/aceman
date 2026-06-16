#!/usr/bin/env bash
# tail-web.sh — follow the aceman_web Python frontend log.
#
# The wrapper at $REPO/aceman_web appends every run to
# $XDG_CACHE_HOME/aceman/web.log (defaults to ~/.cache/aceman/web.log).
# Each session is prefixed by a "=== <timestamp> aceman_web starting ==="
# line so you can find where the current run begins.

set -e
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/aceman/web.log"

if [ ! -f "$LOG" ]; then
    echo "tail-web: $LOG doesn't exist yet — has aceman_web run since the" >&2
    echo "tail-web: logging change? Start ./aceman_web at least once." >&2
    exit 1
fi

# --follow=name (rather than the default --follow=descriptor) reopens
# the file by path so a rotation or truncation doesn't leave us
# following the now-detached inode.
exec tail -n 200 --follow=name --retry "$LOG"
