@echo off
setlocal EnableExtensions

:: --- self-elevate to Administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    if "%~1"=="" (
        powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    ) else (
        powershell -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
    )
    exit /b
)

if /i "%~1"=="phase2" goto phase2

:: If WSL is already enabled from a previous install, skip the enable+reboot
:: and go straight to provisioning. The reboot is only needed the FIRST time
:: the optional features are turned on; once they read 'Enabled' (not
:: 'EnablePending') they're active and a distro installs without a restart.
:: This is what lets a re-install avoid the reboot dance. Needs admin, which
:: we already self-elevated to above.
echo Checking whether WSL is already enabled...
powershell -NoProfile -Command "if((Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux).State -eq 'Enabled' -and (Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State -eq 'Enabled'){exit 0}else{exit 1}"
if %errorlevel%==0 (
    echo WSL is already enabled - skipping the reboot, going straight to provisioning.
    echo.
    goto phase2
)

:: ================= PHASE 1: enable WSL, then reboot =================
echo === Phase 1: enabling WSL (no distro yet) ===

:: schedule phase 2 to auto-run at next login
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" ^
    /v AcemanSetup /t REG_SZ /d "\"%~f0\" phase2" /f

:: enable WSL itself WITHOUT a distro - distro install happens in phase 2,
:: after the reboot, when the feature is actually active.
wsl --install --no-distribution
wsl --set-default-version 2

echo.
echo WSL enabled. A reboot is needed before a distro can be installed.
echo Phase 2 (install Ubuntu + provision) runs automatically after login.
echo.
echo IMPORTANT: phase 2 downloads Ubuntu, packages and the repo, so it
echo needs INTERNET right after reboot. Make sure WiFi connects
echo automatically at startup (disable any "WiFi off at boot" setting).
echo.
choice /c YN /m "Is WiFi set to connect on startup, ready to reboot"
if errorlevel 2 (
    echo.
    echo Skipped. Reboot yourself when ready - phase 2 runs at next login.
    echo Or run manually after reboot:  "%~f0" phase2
    pause
    exit /b
)
shutdown /r /t 5
exit /b

:: ================= PHASE 2: install distro + provision =================
:phase2
echo === Phase 2: installing Ubuntu + provisioning ===

:: feature is active now - actually install the distro
echo Installing Ubuntu...
wsl --install -d Ubuntu --no-launch

:: wait until the distro is registered AND runnable before provisioning
echo Waiting for Ubuntu to be ready...
set /a tries=0
:waitloop
set /a tries+=1
wsl -d Ubuntu -u root -- true >nul 2>&1
if not errorlevel 1 goto ready
if %tries% geq 36 goto notready
timeout /t 5 /nobreak >nul
goto waitloop

:notready
echo.
echo Ubuntu did not become ready in time. Check "wsl --list --verbose",
echo then re-run:  "%~f0" phase2
pause
exit /b

:ready
:: resolve the wsl path of setup.sh in internal/
for /f "delims=" %%i in ('wsl wslpath -a "%~dp0internal\setup.sh"') do set "SH=%%i"

:: strip CRLF and run as root inside Ubuntu
wsl -d Ubuntu -u root -- bash -c "tr -d '\r' < '%SH%' | bash"

:: create the Windows Desktop shortcut (arg = run silently, no extra pause)
echo Creating Desktop shortcut...
call "%~dp0internal\shortcut.bat" silent

:: Apply /etc/wsl.conf NOW so the steps below run as the 'ace' user. setup.sh
:: cloned the repo to ace's home (~/Projects/aceman) and set default=ace, but
:: wsl.conf only takes effect on a fresh boot. Until this shutdown, `wsl` still
:: logs in as root - whose ~ has no clone - so the engine import would fail with
:: "~/Projects/aceman not found". The trailing shutdown below re-applies this
:: (plus any networking change); an extra shutdown here is harmless.
echo Applying WSL config so the next steps run as 'ace'...
wsl --shutdown

:: The Ace Stream engine tarball is proprietary and NOT shipped in the repo, so
:: nothing plays until it's imported once. Offer it here so a fresh install is
:: play-ready - otherwise the first launch dead-ends on "engine.tar.gz missing".
:: import_engine.bat looks in Downloads and, if the file isn't there yet, prints
:: the download link and waits. Say N to skip and run import_engine.bat later.
echo.
echo The Ace Stream engine is what actually PLAYS streams. It's a separate,
echo proprietary download that is NOT bundled with aceman, so it has to be
echo imported once. If you say Yes and it isn't in your Downloads yet, a
echo window opens with the download link and waits for you. Say No to do it
echo later with import_engine.bat ^(nothing will play until you do^).
echo.
choice /c YN /m "Import the Ace Stream engine now"
if not errorlevel 2 call "%~dp0import_engine.bat"

:: Optional: let a phone/tablet on your LAN play streams. This switches WSL
:: to "mirrored" networking (enable_shared_networking.bat does the work).
:: Off unless the user opts in - the wsl --shutdown below applies it.
echo.
echo Optional: let ANOTHER device (phone/tablet with VLC) play streams
echo over your LAN. This switches WSL to "mirrored" networking. The
echo engine has no password (aceman still blocks browser drive-by
echo requests), so only enable it on a network you trust. You can also
echo do this later by running enable_shared_networking.bat.
echo.
choice /c YN /m "Enable shared networking for another-device playback"
if not errorlevel 2 call "%~dp0enable_shared_networking.bat" silent

:: setup.sh wrote /etc/wsl.conf (systemd=true + default user). Those only
:: apply on a fresh boot of the distro, so shut it down now - the next
:: launch (run.bat) starts with systemd and logs in as the 'ace' user.
echo Applying WSL config (systemd + default user)...
wsl --shutdown

echo.
echo === Done. Launch with run.bat, or open Ubuntu and run: ===
echo ===   cd ~/Projects/aceman ^&^& ./aceman_web                ===
pause
exit /b
