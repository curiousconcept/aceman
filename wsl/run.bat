@echo off
setlocal EnableExtensions
title aceman_web (WSL)

echo ============================================================
echo  Starting aceman_web inside WSL (Ubuntu)
echo ------------------------------------------------------------
echo  - A browser tab opens automatically once the server is up.
echo  - The address is also printed below in case it doesn't.
echo  - Keep THIS window open while you use aceman.
echo  - Press Ctrl+C here (then Y) to stop the server.
echo ============================================================
echo.

:: Run aceman_web in WSL and stream its output. When the "open in
:: Windows browser" URL appears, wait until the server actually answers,
:: then open it in the default Windows browser. All output keeps
:: streaming so you still see the live logs.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$o=$false; wsl -d Ubuntu -- bash -lc 'cd ~/Projects/aceman && ./aceman_web' 2>&1 | ForEach-Object { Write-Host $_; if(-not $o -and $_ -match 'open in Windows browser: (https?://\S+)'){ $o=$true; $u=$Matches[1].TrimEnd(); Write-Host ''; Write-Host (\"  >>> aceman URL: \" + $u) -ForegroundColor Cyan; for($i=0;$i -lt 40;$i++){ try{ Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $u | Out-Null; break }catch{ Start-Sleep -Milliseconds 700 } }; Start-Process $u } }"

echo.
echo aceman_web has stopped.
pause
exit /b
