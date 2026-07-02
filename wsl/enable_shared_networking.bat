@echo off
setlocal EnableExtensions

:: enable_shared_networking.bat - set up another-device playback under WSL.
:: Two steps:
::   1. switch WSL2 to "mirrored" networking (writes %UserProfile%\.wslconfig,
::      per-user, no admin) so the WSL guest shares your Windows LAN IP;
::   2. open the engine port in Windows firewall so a phone/tablet on the LAN
::      can actually reach it (needs admin - that one step self-elevates).
:: Without step 2 the connection just times out, so both run together.
::
:: Run two ways:
::   double-click     warning + confirm, write config, open firewall, restart WSL
::   ...bat silent    no prompts, no restart - install.bat drives both

set "SILENT="
if /i "%~1"=="silent" set "SILENT=1"

set "FWRULE=aceman-engine-6878"
set "ENGINEPORT=6878"

:: Mirrored networking needs Windows 11 22H2 (build 22621) or newer; older
:: builds silently ignore it, so warn before writing.
set "BUILD=0"
for /f "delims=" %%b in ('powershell -NoProfile -Command "[Environment]::OSVersion.Version.Build"') do set "BUILD=%%b"
if %BUILD% lss 22621 (
    echo.
    echo   WARNING: mirrored networking needs Windows 11 22H2 or newer
    echo   ^(build 22621+^). This PC reports build %BUILD%, which will
    echo   likely IGNORE it - another-device playback won't work this way.
    echo.
    if defined SILENT exit /b 2
    choice /c YN /m "Continue anyway"
    if errorlevel 2 exit /b 1
)

if not defined SILENT (
    echo.
    echo   ================= SECURITY WARNING =================
    echo   This switches WSL to "mirrored" networking ^(WSL shares your
    echo   Windows network interfaces - affects ALL of WSL^) and opens
    echo   Windows firewall port %ENGINEPORT% inbound.
    echo.
    echo   Afterwards, ticking "Expose engine on local network" in the
    echo   aceman UI makes the engine reachable by ANY device on your
    echo   LAN. aceman still blocks web-browser drive-by requests, but
    echo   there is NO password. Only do this on a network you trust -
    echo   never on public or shared Wi-Fi.
    echo.
    echo   Undo any time with disable_shared_networking.bat.
    echo   ===================================================
    echo.
    choice /c YN /m "Enable shared networking now"
    if errorlevel 2 (
        echo Skipped. Nothing changed.
        exit /b 1
    )
)

:: 1) Per-user: write %UserProfile%\.wslconfig (back up once, replace any
::    existing lines, create sections if missing). Two keys in TWO sections:
::      [wsl2] networkingMode=mirrored     - share the Windows LAN interfaces
::      [experimental] hostAddressLoopback=true - let Windows reach the guest
::         over loopback under mirrored mode (NAT did this automatically,
::         mirrored does NOT). Without it run.bat opens http://localhost:8770/
::         and the web UI never loads.
::    hostAddressLoopback is an [experimental] key, NOT a [wsl2] one - putting it
::    under [wsl2] makes WSL warn "unknown key 'wsl2.hostAddressLoopback'".
set "CFG=%UserProfile%\.wslconfig"
if exist "%CFG%" if not exist "%CFG%.aceman-backup" copy /y "%CFG%" "%CFG%.aceman-backup" >nul

powershell -NoProfile -Command ^
  "$cfg = Join-Path $env:USERPROFILE '.wslconfig';" ^
  "$lines = if (Test-Path -LiteralPath $cfg) { @(Get-Content -LiteralPath $cfg) } else { @() };" ^
  "$lines = $lines | Where-Object { $_ -notmatch 'networkingMode' -and $_ -notmatch 'hostAddressLoopback' };" ^
  "if (-not ($lines | Where-Object { $_ -match '\[wsl2\]' })) { $lines = @('[wsl2]') + $lines };" ^
  "if (-not ($lines | Where-Object { $_ -match '\[experimental\]' })) { $lines += '[experimental]' };" ^
  "$out = New-Object System.Collections.Generic.List[string];" ^
  "$w = $false; $e = $false;" ^
  "foreach ($l in $lines) { $out.Add($l); if (-not $w -and $l -match '\[wsl2\]') { $out.Add('networkingMode=mirrored'); $w = $true }; if (-not $e -and $l -match '\[experimental\]') { $out.Add('hostAddressLoopback=true'); $e = $true } };" ^
  "Set-Content -LiteralPath $cfg -Value $out -Encoding ASCII"
if errorlevel 1 (
    echo   FAILED to update %CFG% - nothing changed there.
    if not defined SILENT pause
    exit /b 1
)
echo   [wsl2] networkingMode=mirrored + [experimental] hostAddressLoopback=true written to %CFG%.

:: 2) Machine-wide: open the engine port in Windows firewall. Needs admin, so
::    run netsh through an elevated cmd (one UAC prompt). Delete-then-add keeps
::    it idempotent; the hyphenated rule name has no spaces so no quoting.
if not defined SILENT echo   Approve the admin prompt to open firewall port %ENGINEPORT%...
powershell -NoProfile -Command "Start-Process cmd -Verb RunAs -Wait -ArgumentList '/c netsh advfirewall firewall delete rule name=%FWRULE% & netsh advfirewall firewall add rule name=%FWRULE% dir=in action=allow protocol=TCP localport=%ENGINEPORT%'"
echo   Firewall rule %FWRULE% ^(TCP %ENGINEPORT% inbound^) added.

:: install.bat restarts WSL itself in silent mode.
if defined SILENT exit /b 0

echo   Restarting WSL so it takes effect ^(this stops any running aceman^)...
wsl --shutdown
echo.
echo   Done. Relaunch aceman with run.bat, tick "Expose engine on local
echo   network" in the UI, then scan the QR from your phone/tablet.
pause
exit /b 0
