#!/usr/bin/env bash
#
# Aceman test runner. Drives every unit-test suite in the project:
#
#   1. broker  — host-side allow-list broker (Python 3, stdlib only)
#   2. web     — server + frontend backing logic (Python 3, stdlib only)
#   3. js      — frontend pure-helper modules (Node, stdlib only,
#                run inside a rootless podman container so no host
#                Node install is required — mirrors the project's
#                "no host toolchain" stance).
#
# Exit code is the OR of the three suites. Stops at the first
# failure so the stack trace stays at the bottom of the log.
#
# Usage:
#   tools/run-tests.sh                # everything
#   tools/run-tests.sh broker         # just broker
#   tools/run-tests.sh web js         # web + js
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JS_IMAGE="docker.io/library/node:lts-krypton"

cd "$PROJECT_ROOT"

run_broker() {
  echo "=== broker (python) ==="
  ( cd broker && python3 -m unittest discover -s tests -t . )
}

run_web() {
  echo "=== web (python) ==="
  ( cd web && python3 -m unittest discover -s tests -t . )
}

run_js() {
  echo "=== js (node, containerised) ==="
  if ! command -v podman >/dev/null 2>&1; then
    echo "podman not found on PATH — skipping JS suite." >&2
    return 1
  fi
  # The Node container only needs to see web/ui — the browser tier, which
  # now holds the modules AND their tests (web/ui/tests). Mounting the rest
  # of the repo would expose secrets / build artefacts / the broker socket
  # to a third-party image for no reason. The single read-only bind at the
  # matching path keeps the tests' relative imports (`../domains/foo.js`)
  # working.
  #
  # node --test wants explicit test FILES, not a directory (a directory
  # arg is treated as a module to load → "Cannot find module"). The glob
  # expands on the host (cwd is PROJECT_ROOT) to paths that are valid
  # inside the container too, since web/ui is bound at the matching path.
  podman run --rm --read-only \
    --tmpfs /tmp \
    -v "$PROJECT_ROOT/web/ui":/work/web/ui:ro,Z \
    -w /work \
    "$JS_IMAGE" \
    node --test web/ui/tests/*.test.mjs
}

# Pre-flight: how many JS tests would we be running? The number lives
# in the source files (every `test('…', …)` call), so a quick grep
# tells us before we even spin the container up. Useful for the user
# to see "what would run" without paying the podman start-up cost.
js_test_count() {
  if [ -d "$PROJECT_ROOT/web/ui/tests" ]; then
    grep -RhE "^test\(" "$PROJECT_ROOT/web/ui/tests" 2>/dev/null | wc -l
  else
    echo 0
  fi
}

want="${*:-broker web js}"
status=0
for suite in $want; do
  case "$suite" in
    broker) run_broker || status=$? ;;
    web)    run_web    || status=$? ;;
    js)     run_js     || status=$? ;;
    *)
      echo "unknown suite: $suite" >&2
      echo "valid: broker, web, js" >&2
      exit 2
      ;;
  esac
  [ "$status" -ne 0 ] && break
done

if [ "$status" -eq 0 ]; then
  echo
  echo "all selected suites passed."
else
  echo
  echo "suite failed (exit=$status)." >&2
fi
exit "$status"
