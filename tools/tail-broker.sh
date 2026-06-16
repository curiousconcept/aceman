#!/usr/bin/env bash
# tail-broker.sh — follow the host-side broker's log.
#
# The broker is auto-spawned by $REPO/aceman_web. When the wrapper
# spawns it, output is appended to $XDG_CACHE_HOME/aceman/broker.log.
# If the broker is already running from an earlier session (started
# before this logging change, or detached differently), this file will
# not see its output — the easiest fix is to kill it and let the next
# launch of aceman_web respawn it:
#
#   pkill -f broker/aceman-broker
#   ./aceman_web      # spawns fresh broker with logging

set -e
LOG="${XDG_CACHE_HOME:-$HOME/.cache}/aceman/broker.log"

if [ ! -f "$LOG" ]; then
    echo "tail-broker: $LOG doesn't exist yet — start aceman_web at least" >&2
    echo "tail-broker: once after the logging change for the broker to" >&2
    echo "tail-broker: write here." >&2
    exit 1
fi

exec tail -n 200 --follow=name --retry "$LOG"
