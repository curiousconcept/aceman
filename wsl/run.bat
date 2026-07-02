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

:: Self-heal a stale .wslconfig from an older aceman (misplaced
:: hostAddressLoopback) so WSL stops warning on every call. No-op if clean.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0internal\repair_wslconfig.ps1"

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

:: Wait until the server actually answers, probing from WINDOWS (the browser's
:: own path). The guest port comes up seconds before WSL forwards Windows
:: localhost to it, so a check from inside WSL passed too early and the browser
:: opened to a connection reset. The helper probes the real URL (proxy disabled,
:: so no WPAD/IE lag) and shows a busy mouse cursor while waiting, restored when
:: it returns. See internal\wait_ready.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0internal\wait_ready.ps1" "%URL%"

:: Open in the default browser. cmd's `start` is the reliable launcher here -
:: PowerShell's Start-Process on a bare URL can silently no-op depending on how
:: the http association is registered. The empty "" is start's (required) title.
start "" "%URL%"
echo.
echo Opened %URL% in your browser.
echo The server keeps running in the other window. Close it to stop aceman.
pause
exit /b
