#!/usr/bin/env bash
# Verify the BROWSER bundle — the artifact aceman_web actually serves.
#
# The browser does NOT load ES modules: aceman_web._bundle_js() concatenates
# ui/lib/** + ui/shared/** + ui/domains/** + ui/main.js into one classic-script IIFE, stripping
# import/export. So an ESM-only check (node --test, smoke_import on individual
# modules) can pass while the bundle is broken (e.g. a file not picked up by
# the bundler → a stripped import leaves a name undefined → ReferenceError).
#
# This script generates the real bundle (host python) and runs it under a
# DOM stub in the npm-sandbox (node), catching syntax, duplicate top-level
# identifiers, AND missing-name ReferenceErrors in the init prefix.
#
# Run from web/:  ./ui/tools/check_bundle.sh
set -euo pipefail
cd "$(dirname "$0")/../.."        # web/

gen="ui/tools/.bundle_check.mjs"
trap 'rm -f "$gen"' EXIT

echo "== generating bundle via aceman_web._bundle_js() =="
python3 -c "import aceman_web; open('$gen','w').write(aceman_web._bundle_js())"
echo "   $(wc -c < "$gen") bytes"

echo "== node --check + DOM-stub run (in npm-sandbox) =="
podman run --rm --cap-drop=ALL --security-opt=no-new-privileges --network=none \
  -v "$PWD":/work:ro,Z -w /work localhost/dev-sandbox:vetted bash -c "
    node --check '$gen' && echo '   bundle parses OK'
    node ui/tools/smoke_import.mjs '$gen'
  "
echo "== bundle OK =="
