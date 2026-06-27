#!/usr/bin/env bash
# Provision the Lima guest — the macOS counterpart to
# wsl/internal/setup.sh. Runs INSIDE the guest (piped through `bash`
# by install.command). Installs podman + git + jq and clones the repo.
#
# Simpler than the WSL version: Lima already logs you in as your own
# user with passwordless sudo and a writable Linux home, so there's no
# user creation and no /etc/wsl.conf (systemd) dance.
set -euo pipefail

REPO="https://github.com/curiousconcept/aceman.git"   # HTTPS = no SSH key

echo ">> installing dependencies"
sudo apt-get update -y
sudo apt-get install -y podman git jq

echo ">> cloning repo"
mkdir -p ~/Projects
cd ~/Projects
[ -d aceman ] || git clone "$REPO"

echo ">> provisioning complete"
