#!/usr/bin/env bash
# Register acestream:// -> aceman handler app.
# Counterpart to wsl/internal/register-handler.bat.
#
# Builds an AppleScript applet that catches the acestream:// "open
# location" event and forwards the URL to get_url_stream.command (auto),
# overwrites its Info.plist with our scheme-declaring one, registers it
# with LaunchServices, and (if `duti` is present) makes it the default
# acestream:// handler.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SILENT="${1:-}"

pause() { [ "$SILENT" = silent ] || read -r -p "Press Enter to close..." _; }

GETURL="$(cd "$HERE/.." && pwd)/get_url_stream.command"
DEST="$HOME/Applications/aceman-handler.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# Require IINA or VLC first — without a player there's nothing to hand the
# stream to, so registering would be pointless (mirrors the .bat guard).
if ! ls -d /Applications/IINA.app /Applications/VLC.app \
          "$HOME/Applications/IINA.app" "$HOME/Applications/VLC.app" \
          >/dev/null 2>&1; then
    echo "Handler registration FAILED: no IINA or VLC found."
    echo "Install IINA (https://iina.io) or VLC (https://videolan.org), then re-run."
    pause
    exit 1
fi

# 1. Compile the applet, baking in the get_url path.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed "s|@GETURL@|$GETURL|g" "$HERE/handler.applescript" > "$TMP/handler.applescript"
rm -rf "$DEST"
mkdir -p "$HOME/Applications"
osacompile -o "$DEST" "$TMP/handler.applescript"

# 2. Overwrite the generated Info.plist with our scheme-declaring one.
cp "$HERE/handler-Info.plist" "$DEST/Contents/Info.plist"

# 3. Register with LaunchServices.
"$LSREGISTER" -f "$DEST"

# 4. Make it the DEFAULT acestream:// handler. macOS has no built-in CLI
#    for this; `duti` does it. Without duti the app is registered but the
#    user must pick it once (System Settings, or the first click prompt).
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist")"
echo
if command -v duti >/dev/null 2>&1; then
    duti -s "$BUNDLE_ID" acestream all
    echo "Registered: acestream:// links now open via aceman."
    echo "Clicking a link (including Play in the aceman web UI) plays it in"
    echo "your Mac's IINA/VLC, hardware-accelerated."
else
    echo "Installed the handler app at:"
    echo "  $DEST"
    echo "To make it the DEFAULT acestream:// handler, install duti and re-run:"
    echo "  brew install duti"
    echo "Otherwise pick 'aceman' the first time macOS prompts on an"
    echo "acestream:// click."
fi
echo "Note: the handler points at this folder. If you move the kit, re-run this."
pause
