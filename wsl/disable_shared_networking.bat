@echo off
setlocal EnableExtensions

:: disable_shared_networking.bat - undo enable_shared_networking.bat: revert
:: WSL2 to default (NAT) networking and remove the engine firewall rule, then
:: restart WSL. Config edit is per-user; the firewall removal self-elevates.

set "FWRULE=aceman-engine-6878"
set "CFG=%UserProfile%\.wslconfig"

echo.
echo   This reverts WSL to default ^(NAT^) networking and closes Windows
echo   firewall port 6878. Other devices on your LAN will no longer reach
echo   the aceman engine.
echo.
choice /c YN /m "Disable shared networking now"
if errorlevel 2 (
    echo Skipped. Nothing changed.
    exit /b 1
)

:: 1) Per-user: drop the networkingMode + hostAddressLoopback lines that
::    enable_shared_networking.bat added (leave the rest of the file).
powershell -NoProfile -Command "$cfg = Join-Path $env:USERPROFILE '.wslconfig'; if (Test-Path -LiteralPath $cfg) { Set-Content -LiteralPath $cfg -Value (@(Get-Content -LiteralPath $cfg) | Where-Object { $_ -notmatch 'networkingMode' -and $_ -notmatch 'hostAddressLoopback' }) -Encoding ASCII }"
echo   Removed networkingMode + hostAddressLoopback from %CFG% ^(if present^).

:: 2) Machine-wide: remove the firewall rule (needs admin - one UAC prompt).
echo   Approve the admin prompt to remove the firewall rule...
powershell -NoProfile -Command "Start-Process cmd -Verb RunAs -Wait -ArgumentList '/c netsh advfirewall firewall delete rule name=%FWRULE%'"
echo   Firewall rule %FWRULE% removed.

echo   Restarting WSL so it takes effect ^(this stops any running aceman^)...
wsl --shutdown
echo.
echo   Done. WSL is back on default networking. Relaunch aceman with run.bat.
pause
exit /b 0
