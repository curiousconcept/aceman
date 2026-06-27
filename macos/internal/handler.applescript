-- aceman acestream:// handler.
--
-- macOS delivers a clicked acestream:// URL to an app via the
-- "open location" Apple Event — NOT as argv — which is why this is an
-- AppleScript applet rather than a plain shell shim. register-handler.command
-- compiles this with osacompile and overwrites the bundle's Info.plist
-- with internal/handler-Info.plist (which declares the URL scheme).
--
-- @GETURL@ is replaced with the absolute path to get_url_stream.command
-- at registration time.

on open location this_URL
	do shell script "/bin/bash " & quoted form of "@GETURL@" & " " & quoted form of this_URL & " auto > /dev/null 2>&1 &"
end open location

on run
	display dialog "aceman acestream:// handler. Click an acestream:// link (including Play in the aceman web UI) to use it." buttons {"OK"} default button 1
end run
