#!/usr/bin/env bash
# aceman macOS installer — counterpart to wsl/install.bat.
# Installs Lima, then creates and provisions the 'aceman' Linux guest.
# Double-click in Finder, or run from a terminal.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== aceman macOS install ==="

# 1. Homebrew + Lima -------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required. Install it from https://brew.sh then re-run." >&2
    exit 1
fi
if ! command -v limactl >/dev/null 2>&1; then
    echo ">> installing Lima"
    brew install lima
fi

# 2. Create + start the guest (idempotent) --------------------------------
if limactl list --format '{{.Name}}' 2>/dev/null | grep -qx aceman; then
    echo ">> Lima VM 'aceman' already exists; starting it"
    limactl start aceman
else
    echo ">> creating Lima VM 'aceman' (first boot downloads an Ubuntu image)"
    limactl start --name=aceman --tty=false "$HERE/internal/lima.yaml"
fi

# 3. Provision inside the guest (podman, git, clone) ----------------------
# Pipe setup.sh through the guest's bash, mirroring wsl/install.bat's
# `tr -d '\r' < setup.sh | bash`.
echo ">> provisioning the guest"
limactl shell aceman -- bash -s < "$HERE/internal/setup.sh"

cat <<'EOF'

=== Install complete ===
Next:
  1. Provide the engine tarball (needed to play).
     Easy way: double-click import_engine.command — it finds the
       acestream...ubuntu...x86_64...tar.gz in your Downloads (or waits
       while you download it) and installs it into the guest for you.
     Manual way: get the Linux -> Ubuntu, amd64 / py3.10 build from
       https://docs.acestream.net/products/#linux, rename it to
       engine.tar.gz, and place it in the guest at
       ~/Projects/aceman/engine/container/dist/engine.tar.gz
       (open the guest with:  limactl shell aceman)
  2. Launch:  double-click run.command
  3. Optional acestream:// click-to-play:
       internal/register-handler.command
EOF
