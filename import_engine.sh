#!/usr/bin/env bash
# import_engine.sh — find the Ace Stream engine tarball in your Downloads,
# verify it against the vetted SHA-256 aceman ships, and install it as
# engine/container/dist/engine.tar.gz (the file aceman needs to build the
# engine image; it's proprietary, so the repo can't ship the tarball itself).
#
# Matches any file in Downloads whose name contains acestream + ubuntu +
# x86_64 and ends in .tar.gz (case-insensitive), e.g.
#   acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz
#
# Verification: the repo ships engine/container/dist/engine.tar.gz.sha256 —
# the author's vetted hash. A tarball whose hash doesn't match is REFUSED:
# either the upstream build changed since this aceman was released, or the
# file is corrupt. You're told to fetch the matching build and drop it in
# Downloads; the script waits and re-scans. If no hasher or no shipped hash
# is available, verification degrades to a skip (with a warning).
#
# If no tarball is found it offers to download it for you (curl/wget) or
# prints the URL and WAITS without closing, so you can grab it in a browser.
#
# Downloads dir resolution: $ACE_DOWNLOADS (the WSL/macOS wrappers point this
# at the host Downloads folder) → $XDG_DOWNLOAD_DIR → ~/Downloads.

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DOWNLOADS="${ACE_DOWNLOADS:-${XDG_DOWNLOAD_DIR:-$HOME/Downloads}}"
DIST_DIR="$SCRIPT_DIR/engine/container/dist"
DEST="$DIST_DIR/engine.tar.gz"
REF_SHA_FILE="$DIST_DIR/engine.tar.gz.sha256"
URL="https://download.acestream.media/linux/acestream_3.2.11_ubuntu_22.04_x86_64_py3.10.tar.gz"

# Vetted hash aceman ships (first token of the .sha256 file). Empty if the
# file is absent — verification then degrades to a skip-with-warning.
REF_HASH=""
[ -f "$REF_SHA_FILE" ] && REF_HASH="$(awk '{print $1; exit}' "$REF_SHA_FILE")"

# Portable SHA-256 of a file → stdout hex; non-zero if no hasher exists.
file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1; exit}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1; exit}'
    else
        return 1
    fi
}

# Compare a candidate against the vetted hash. 0 = matches (or can't check),
# 1 = mismatch. A mismatch is loud: it means the engine source changed.
verify_tarball() {
    local src="$1" got
    if [ -z "$REF_HASH" ]; then
        echo "import_engine: no vetted hash shipped ($REF_SHA_FILE) — skipping verification." >&2
        return 0
    fi
    got="$(file_sha256 "$src")" || {
        echo "import_engine: no sha256sum/shasum found — skipping verification." >&2
        return 0
    }
    [ "$got" = "$REF_HASH" ] && { echo "import_engine: hash matches the vetted engine build."; return 0; }
    echo >&2
    echo "import_engine: HASH MISMATCH — this is NOT the engine build aceman was vetted against." >&2
    echo "  vetted:    $REF_HASH" >&2
    echo "  this file: $got" >&2
    echo "  The Ace Stream engine download has changed since this aceman was released," >&2
    echo "  or the file is corrupt. aceman won't install an unvetted engine." >&2
    echo "  Get the matching build, put it in your Downloads, then retry." >&2
    echo >&2
    return 1
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

# Verify, then install. 0 = installed (or kept existing), 1 = rejected.
use_tarball() {
    verify_tarball "$1" || return 1
    install_tarball "$1"
}

# Newest-agnostic: return the first file in Downloads matching the pattern.
# -iname (case-insensitive) and -maxdepth work on both GNU and BSD find.
find_tarball() {
    find "$DOWNLOADS" -maxdepth 1 -type f \
        -iname '*acestream*ubuntu*x86_64*.tar.gz' 2>/dev/null | head -1
}

echo "import_engine: looking for the Ace Stream engine tarball in: $DOWNLOADS"
tb="$(find_tarball)"
if [ -n "$tb" ]; then
    echo "import_engine: found $tb"
    use_tarball "$tb" && exit 0
    # Rejected (hash mismatch) → drop into the wait loop for the correct file.
else
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
                    use_tarball "$out" && exit 0
                    # Downloaded but rejected (upstream changed) → wait loop.
                else
                    echo "import_engine: download failed — falling back to manual." >&2
                fi
                ;;
        esac
    fi
fi

# Wait loop: keep the terminal open; on Enter re-scan and (re)verify. Reached
# both when nothing was found and when a found/downloaded file failed the hash
# check — so the user can drop in the correct, matching build and continue.
echo
echo "Put the matching engine tarball in your Downloads, then press Enter here"
echo "to retry (or type q then Enter to quit). This window stays open — waiting."
while true; do
    read -r reply
    case "$reply" in
        q|Q) echo "import_engine: quit without installing."; exit 1 ;;
    esac
    tb="$(find_tarball)"
    if [ -z "$tb" ]; then
        echo "import_engine: still no matching tarball in $DOWNLOADS — try again, or q to quit."
        continue
    fi
    echo "import_engine: found $tb"
    use_tarball "$tb" && exit 0
    echo "import_engine: that file was rejected — replace it and press Enter, or q to quit."
done
