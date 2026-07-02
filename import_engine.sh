#!/usr/bin/env bash
# import_engine.sh — find the Ace Stream engine tarball in your Downloads and
# install it as engine/container/dist/engine.tar.gz (the file aceman needs to
# build the engine image; it's proprietary, so the repo can't ship it).
#
# Matches any file in Downloads whose name contains acestream + ubuntu +
# x86_64 and ends in .tar.gz (case-insensitive), e.g.
#   acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz
#
# If none is found it offers to download it for you (needs curl or wget);
# otherwise it prints the URL and WAITS without closing, so you can download
# it in a browser, then press Enter to re-scan and install.
#
# Downloads dir resolution: $ACE_DOWNLOADS (the WSL .bat points this at the
# Windows Downloads folder) → $XDG_DOWNLOAD_DIR → ~/Downloads.

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DOWNLOADS="${ACE_DOWNLOADS:-${XDG_DOWNLOAD_DIR:-$HOME/Downloads}}"
DIST_DIR="$SCRIPT_DIR/engine/container/dist"
DEST="$DIST_DIR/engine.tar.gz"
URL="https://download.acestream.media/linux/acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz"

# Newest-agnostic: return the first file in Downloads matching the pattern.
# -iname (case-insensitive) and -maxdepth work on both GNU and BSD find.
find_tarball() {
    find "$DOWNLOADS" -maxdepth 1 -type f \
        -iname '*acestream*ubuntu*x86_64*.tar.gz' 2>/dev/null | head -1
}

install_tarball() {
    local src="$1"
    if ! mkdir -p "$DIST_DIR"; then
        echo "import_engine: cannot create $DIST_DIR" >&2
        return 1
    fi
    if [ -e "$DEST" ]; then
        printf 'import_engine: %s already exists. Overwrite? [y/N] ' "$DEST"
        read -r reply
        case "$reply" in
            y|Y|yes|YES) : ;;
            *) echo "import_engine: kept the existing engine.tar.gz."; return 0 ;;
        esac
    fi
    if cp "$src" "$DEST"; then
        echo "import_engine: installed engine tarball -> $DEST"
        return 0
    fi
    echo "import_engine: failed to copy into $DIST_DIR" >&2
    return 1
}

echo "import_engine: looking for the Ace Stream engine tarball in: $DOWNLOADS"
tb="$(find_tarball)"
if [ -n "$tb" ]; then
    echo "import_engine: found $tb"
    install_tarball "$tb"
    exit $?
fi

echo "import_engine: no 'acestream…ubuntu…x86_64….tar.gz' found in $DOWNLOADS."
echo "It's proprietary, so aceman can't ship it. Download it from:"
echo "  $URL"
echo

# Offer an automatic download if we have a downloader.
downloader=""
command -v curl >/dev/null 2>&1 && downloader="curl"
[ -z "$downloader" ] && command -v wget >/dev/null 2>&1 && downloader="wget"
if [ -n "$downloader" ]; then
    printf 'Download it now automatically (%s)? [Y/n] ' "$downloader"
    read -r reply
    case "$reply" in
        n|N|no|NO) : ;;
        *)
            mkdir -p "$DOWNLOADS"
            out="$DOWNLOADS/acestream_engine.tar.gz"
            echo "import_engine: downloading…"
            if [ "$downloader" = curl ]; then
                curl -fL --retry 3 -o "$out" "$URL"
            else
                wget -O "$out" "$URL"
            fi
            if [ $? -eq 0 ] && [ -s "$out" ]; then
                install_tarball "$out"
                exit $?
            fi
            echo "import_engine: download failed — falling back to manual." >&2
            ;;
    esac
fi

# Manual path: keep the terminal open, let the user download in a browser,
# then re-scan on Enter and install.
echo
echo "Download the file into your Downloads folder, then press Enter here."
echo "(this window stays open — waiting for you)"
read -r _
tb="$(find_tarball)"
if [ -n "$tb" ]; then
    echo "import_engine: found $tb"
    install_tarball "$tb"
    exit $?
fi
echo "import_engine: still no matching tarball in $DOWNLOADS." >&2
echo "Re-run this script once the download finishes." >&2
exit 1
