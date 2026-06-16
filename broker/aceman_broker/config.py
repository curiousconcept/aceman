"""Frozen broker configuration — read once at process start.

All knobs land here from environment variables, get validated, and
are exposed as module-level constants. Nothing in the broker reads
``os.environ`` directly afterwards — that way a hostile env can only
affect us at boot, never mid-request.

The validators raise on bad input; ``main()`` catches and exits with
a useful message rather than letting a bad config silently shape an
attacker-controlled ``podman`` argv later.
"""

from __future__ import annotations

import os
import pathlib
import sys

from .validators import (
    validate_container_name,
    validate_engine_url,
    validate_image_tag,
)


# Container + image names. Validated against the same charset rules
# the action handlers will use when forming `podman ps --filter
# name=^...$` queries — a bad value here is the only way to get a
# `;` or `$` into the podman argv pool.
NAME = os.environ.get("ACE_NAME", "ace")
WEB_NAME = os.environ.get("ACE_WEB_NAME", "aceman-web")
IMAGE = os.environ.get("ACE_IMAGE", "localhost/acestream:vetted")

# Engine HTTP endpoint. Locked to loopback; see validators.
ENGINE_URL = os.environ.get(
    "ACE_ENGINE_URL", "http://127.0.0.1:6878").rstrip("/")

# Project root for finding container/engine/run-container.sh — used
# when building the engine image.
PROJECT_ROOT = pathlib.Path(
    os.environ.get("ACE_PROJECT_ROOT")
    or pathlib.Path(__file__).resolve().parent.parent.parent
)
RUN_SH = PROJECT_ROOT / "container" / "engine" / "run-container.sh"

# Timeouts + caps. None of these are user-controllable.
MAX_REQ_BYTES = 4 * 1024        # one JSON object, plenty of headroom
CONN_TIMEOUT = 5.0              # per-connection seconds
START_WAIT_SECONDS = 30         # engine boot poll budget
LAUNCHER_TIMEOUT = 60           # `bash run-container.sh -d` wall clock
STOP_TIMEOUT = 15               # `podman stop` wall clock
RMI_TIMEOUT = 30                # `podman rmi -f` wall clock
PROBE_TIMEOUT = 5.0             # urlopen timeout for engine probe
BUILD_LOG_CAP = 500             # bounded in-memory log buffer


def validate_at_startup() -> None:
    """Validate env-derived constants. Called by ``main()`` before
    any socket work starts. Raises ``SystemExit`` on failure with a
    short message — anything more verbose just buys an attacker more
    info about how their input was rejected."""
    try:
        validate_container_name(NAME)
        validate_container_name(WEB_NAME)
        validate_image_tag(IMAGE)
        validate_engine_url(ENGINE_URL)
    except ValueError as e:
        sys.exit(f"aceman-broker: {e}")
    if not RUN_SH.is_file():
        sys.exit(f"aceman-broker: launcher not found at {RUN_SH}")
