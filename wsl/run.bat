@echo off
setlocal EnableExtensions
title aceman launcher

echo ============================================================
echo  Launching aceman_web
echo ------------------------------------------------------------
echo  A SECOND window opens with the LIVE server logs.
echo   - Keep that window open while you use aceman.
echo   - Close it (or Ctrl+C in it) to stop the server.
echo  THIS window waits for the URL, then opens your browser.
echo ============================================================
echo.

:: Truncate the web log first so we read THIS run's URL, not a stale one.
wsl -d Ubuntu -- bash -lc "mkdir -p ~/.cache/aceman; : > ~/.cache/aceman/web.log" 2>nul

:: Server in its OWN window = real TTY = live, unbuffered logs. The
:: trailing 'read' keeps the window open after the server stops so any
:: error stays visible.
start "aceman_web - live logs (keep open)" wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman && ./aceman_web; echo; echo [server stopped - press Enter to close]; read _"

echo Waiting for the server URL (first launch builds images, can take a few minutes)
set "URL="
for /l %%n in (1,1,120) do (
    <nul set /p "=."
    for /f "usebackq delims=" %%u in (`wsl -d Ubuntu -- bash -lc "grep -oP 'open in Windows browser: \Khttp\S+' ~/.cache/aceman/web.log 2>/dev/null | tail -1"`) do set "URL=%%u"
    if defined URL goto goturl
    timeout /t 3 /nobreak >nul
)
echo.
echo Timed out waiting for the URL. Check the live-logs window for errors.
pause
exit /b

:goturl
echo.
echo Found URL: %URL%
echo Waiting for the server to actually respond, then opening your browser...

:: The URL is logged BEFORE the web container is serving, so we must wait for a
:: real response. Probe INSIDE WSL (bash /dev/tcp + an actual HTTP request, the
:: same check aceman_web uses) - fast and local. The old Windows-side
:: Invoke-WebRequest to localhost paid IPv6/proxy/IE overhead and opened the
:: browser long after the server was ready. A bare TCP connect isn't enough:
:: podman's netstack accepts the handshake before Python calls serve_forever(),
:: so we wait for an 'HTTP/' response line. ~30s cap, then open regardless.
:: Port comes from the URL (tokens split on : and /); default 8770 if unparsed.
for /f "tokens=3 delims=:/" %%p in ("%URL%") do set "PORT=%%p"
if not defined PORT set "PORT=8770"
wsl -d Ubuntu -- bash -lc "for i in $(seq 1 60); do if (exec 3<>/dev/tcp/127.0.0.1/%PORT%; printf 'GET / HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3; head -1 <&3 | grep -q '^HTTP/') 2>/dev/null; then exit 0; fi; sleep 0.5; done; exit 1"

:: Open in the default browser. cmd's `start` is the reliable launcher here -
:: PowerShell's Start-Process on a bare URL can silently no-op depending on how
:: the http association is registered. The empty "" is start's (required) title.
start "" "%URL%"
echo.
echo Opened %URL% in your browser.
echo The server keeps running in the other window. Close it to stop aceman.
pause
exit /b
