#!/usr/bin/env bash
#
# check_install_dependencies.sh — verify (and, with your OK, install) the
# host tools aceman needs:
#
#   Podman >= 4.0   container runtime (rootless)
#   Python >= 3.9   web + broker (stdlib only — no pip packages)
#   bash   >= 4     the shell wrappers
#   curl, jq        used by the wrappers to talk to the engine API
#
# Works across the mainstream package managers: apt, dnf/yum, pacman,
# zypper, apk. At the end it can optionally install mpv + VLC as
# locked-down Flatpaks for the external-player path.
#
# Read-only by default for anything already satisfied; it only installs
# what's missing, and asks before touching your system.

set -euo pipefail

# ---- output helpers (colour only on a tty) ---------------------------------
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; Z=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; Z=''
fi
ok()   { printf '%s  ok %s %s\n'   "$G" "$Z" "$*"; }
warn() { printf '%s warn%s %s\n'   "$Y" "$Z" "$*"; }
err()  { printf '%s fail%s %s\n'   "$R" "$Z" "$*" >&2; }
section() { printf '\n%s%s%s\n' "$B" "$*" "$Z"; }

# ---- root / sudo -----------------------------------------------------------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi

# ---- package-manager detection ---------------------------------------------
# PM names the manager; PM_INSTALL is the install verb. Detection is by
# binary presence, not /etc/os-release, so derivatives just work.
detect_pm() {
  if   command -v apt-get >/dev/null 2>&1; then PM=apt
  elif command -v dnf     >/dev/null 2>&1; then PM=dnf
  elif command -v yum     >/dev/null 2>&1; then PM=yum
  elif command -v pacman  >/dev/null 2>&1; then PM=pacman
  elif command -v zypper  >/dev/null 2>&1; then PM=zypper
  elif command -v apk     >/dev/null 2>&1; then PM=apk
  elif command -v rpm-ostree >/dev/null 2>&1; then PM=rpm-ostree
  else PM=unknown
  fi
}

# Map a generic name to this distro's package name. Only python differs
# (Arch ships it as `python`); the rest are identical everywhere.
pkg_name() {
  case "$1" in
    python3) case "$PM" in pacman) echo python ;; *) echo python3 ;; esac ;;
    *) echo "$1" ;;
  esac
}

pm_install() {
  # $@ = package names. Echos the command, then runs it.
  local pkgs="$*"
  case "$PM" in
    apt)    $SUDO apt-get update && $SUDO apt-get install -y $pkgs ;;
    dnf)    $SUDO dnf install -y $pkgs ;;
    yum)    $SUDO yum install -y $pkgs ;;
    pacman) $SUDO pacman -S --needed --noconfirm $pkgs ;;
    zypper) $SUDO zypper install -y $pkgs ;;
    apk)    $SUDO apk add $pkgs ;;
    rpm-ostree)
      $SUDO rpm-ostree install -y --idempotent --allow-inactive $pkgs
      warn "rpm-ostree layered the packages — reboot to activate them." ;;
    *) err "no supported package manager found — install manually: $pkgs"; return 1 ;;
  esac
}

# ---- version compare -------------------------------------------------------
# version_ge A B  → true when A >= B (dotted numeric, via sort -V).
version_ge() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]
}

# Pull the first dotted-number token out of a tool's --version line.
ver_of() { grep -oE '[0-9]+(\.[0-9]+)+' | head -n1; }

# ---- the checks ------------------------------------------------------------
# Anything missing or too old gets its package name appended to NEED.
NEED=""
add_need() { case " $NEED " in *" $1 "*) ;; *) NEED="$NEED $1" ;; esac; }

check_min() {
  # check_min <label> <cmd> <min> <installed-version-or-empty> <pkg-generic>
  local label="$1" cmd="$2" min="$3" cur="$4" generic="$5"
  if [ -z "$cur" ]; then
    err "$label missing (need >= $min)"
    add_need "$(pkg_name "$generic")"
  elif version_ge "$cur" "$min"; then
    ok "$label $cur (>= $min)"
  else
    warn "$label $cur is older than $min — will try to upgrade"
    add_need "$(pkg_name "$generic")"
  fi
}

check_present() {
  # check_present <label> <cmd> <pkg-generic>
  local label="$1" cmd="$2" generic="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$label present"
  else
    err "$label missing"
    add_need "$(pkg_name "$generic")"
  fi
}

detect_pm
section "Package manager: ${PM}"
[ "$PM" = unknown ] && warn "unrecognised distro — I can still report, but can't auto-install"

section "Checking dependencies"
check_min "Podman" podman  4.0 "$(command -v podman  >/dev/null 2>&1 && podman  --version 2>/dev/null | ver_of)" podman
check_min "Python" python3 3.9 "$(command -v python3 >/dev/null 2>&1 && python3 --version 2>&1     | ver_of)" python3
check_min "bash"   bash    4.0 "$(bash --version 2>/dev/null | ver_of)" bash
check_present "curl" curl curl
check_present "jq"   jq   jq

# ---- install the gaps ------------------------------------------------------
if [ -n "${NEED# }" ]; then
  section "Missing / outdated:${NEED}"
  if [ "$PM" = unknown ]; then
    err "can't auto-install on this distro — install the above and re-run."
    exit 1
  fi
  if [ -t 0 ]; then
    printf 'Install with %s now? [Y/n] ' "$PM"; read -r ans
    case "$ans" in n|N|no) echo "skipped."; exit 1 ;; esac
  fi
  pm_install $NEED
  if [ "$PM" != rpm-ostree ]; then
    section "Re-checking after install"
    podman_now="$(command -v podman >/dev/null 2>&1 && podman --version 2>/dev/null | ver_of)"
    if [ -n "$podman_now" ] && ! version_ge "$podman_now" 4.0; then
      warn "Podman is still $podman_now (< 4.0). Your distro's repo is behind;"
      warn "see https://podman.io/docs/installation for a newer build."
    fi
  fi
else
  section "All required dependencies satisfied."
fi

# ---- optional: locked-down flatpak players ---------------------------------
# aceman hands the player an HTTP stream URL from the engine, never a local
# file — so the player needs network + audio + display and NO disk access.
# host:reset wipes both host access and the app's own manifest filesystem
# grants in one shot.
APPS="io.mpv.Mpv org.videolan.VLC"

lockdown_player() {
  flatpak override --user --nofilesystem=host:reset "$1"
}

install_players_flatpak() {
  if ! command -v flatpak >/dev/null 2>&1; then
    [ "$PM" = unknown ] && { err "flatpak missing and no known package manager."; return 1; }
    pm_install flatpak
  fi
  flatpak remote-add --user --if-not-exists flathub \
    https://flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y flathub $APPS

  section "Locking down file access"
  for app in $APPS; do
    lockdown_player "$app"
    ok "$app — host:reset applied (no filesystem access)"
  done
  echo
  echo "Verify any time with:  flatpak info --show-permissions io.mpv.Mpv"
}

install_players_native() {
  [ "$PM" = unknown ] && { err "no known package manager — install vlc + mpv manually."; return 1; }
  section "Installing native vlc + mpv"
  if pm_install vlc mpv; then
    ok "native vlc + mpv installed (standard system permissions, full disk access)"
  else
    warn "native install failed — VLC on Fedora/openSUSE needs RPM Fusion /"
    warn "Packman repos, and rpm-ostree needs those layered first. The Flatpak"
    warn "option avoids all that (re-run and pick 1)."
  fi
}

# ---- browser H.264 advisory ------------------------------------------------
# Browser playback decodes H.264 in the BROWSER, not in our container. Fedora
# (notably the atomic variants) ships a codec-stripped ffmpeg
# (libavcodec-free) with NO H.264, so every stream fails with
# MEDIA_ERR_DECODE. Detect and point at the fix. Advisory only — not a
# blocker, and unrelated to the transcode ffmpeg which lives in the image.
check_browser_h264() {
  section "Browser H.264 decode"
  if command -v ffmpeg >/dev/null 2>&1; then
    # awk consumes the whole stream (no early exit) so grep -q's SIGPIPE
    # can't trip `set -o pipefail` into a false "missing" result. Matches
    # the native libavcodec h264 decoder — the one the browser's MSE path
    # uses (libopenh264/h264_* hwaccels don't cover it).
    if ffmpeg -hide_banner -decoders 2>/dev/null \
         | awk '$2 == "h264" { found = 1 } END { exit !found }'; then
      ok "system ffmpeg has the H.264 decoder"
      return
    fi
    warn "system ffmpeg has NO H.264 decoder (codec-stripped build)"
  elif command -v rpm >/dev/null 2>&1 && rpm -q libavcodec-free >/dev/null 2>&1; then
    warn "libavcodec-free present — codec-stripped ffmpeg, no H.264"
  else
    ok "no codec-stripped ffmpeg detected"
    return
  fi
  warn "Browser playback will fail with MEDIA_ERR_DECODE. Fix with either:"
  warn "  • a Flatpak browser (bundles its own H.264), or"
  warn "  • full ffmpeg from RPM Fusion (see the README: 'Fedora / atomic:"
  warn "    enabling H.264 for browser playback')."
}

# ---- NVIDIA NVENC advisory -------------------------------------------------
# h264_nvenc runs inside the web container and loads the host driver's
# libcuda.so.1, which only reaches the container when the GPU is injected via
# CDI. Without a CDI spec, NVENC fails with "Cannot load libcuda.so.1"
# (issue #12) and aceman falls back to CPU. Only relevant with an NVIDIA GPU,
# so stay silent otherwise.
check_nvidia_cdi() {
  command -v nvidia-smi >/dev/null 2>&1 || return 0
  section "NVIDIA GPU encode (NVENC)"
  local spec="" f
  for f in /etc/cdi/nvidia*.yaml /etc/cdi/nvidia*.json \
           /var/run/cdi/nvidia*.yaml /var/run/cdi/nvidia*.json; do
    [ -e "$f" ] && { spec="$f"; break; }
  done
  if [ -n "$spec" ]; then
    ok "CDI spec present ($spec) — the container can load libcuda for NVENC"
    return
  fi
  warn "NVIDIA driver found but no CDI spec — the web container can't load"
  warn "libcuda, so GPU encode falls back to CPU. Install the NVIDIA Container"
  warn "Toolkit, then generate the spec:"
  warn "  sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml"
  warn "  (toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)"
}

offer_players() {
  [ -t 0 ] || return 0   # never prompt non-interactively
  section "Optional: external players (mpv + VLC)"
  echo "Browser playback needs no player. For the './aceman' external-player"
  echo "path you can install mpv + VLC. Choose how:"
  echo "  1) Flatpak  — locked to NO filesystem access (recommended)"
  echo "  2) Native   — your distro's vlc + mpv packages (normal permissions)"
  echo "  3) None     — skip"
  printf 'Select [1/2/3] (default 1): '; read -r choice
  case "${choice:-1}" in
    1) install_players_flatpak ;;
    2) install_players_native ;;
    *) echo "skipped players." ;;
  esac
}

check_browser_h264
check_nvidia_cdi
offer_players

section "Done."
