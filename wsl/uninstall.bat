@echo off
setlocal EnableExtensions

:: --- self-elevate to Administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo === aceman WSL uninstaller ===
echo.
echo Currently installed distros:
wsl --list --verbose
echo.
echo This will:
echo   1. Unregister (DELETE) the Ubuntu distro and ALL its files
echo   2. Optionally uninstall the WSL app itself (asked separately below)
echo.
echo *** This permanently deletes everything inside the distro. ***
echo.
choice /c YN /m "Continue"
if errorlevel 2 (
    echo Aborted. Nothing was changed.
    pause
    exit /b
)

:: Offer to save favourites to Downloads before the distro (and its config)
:: is deleted. The distro is still registered here, so the backup can read it.
echo.
choice /c YN /m "Save aceman favourites to your Downloads first"
if not errorlevel 2 call "%~dp0backup_to_downloads.bat" nopause

:: clear any leftover auto-resume key from the installer
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v AcemanSetup /f >nul 2>&1

:: remove the acestream:// protocol handler if it was registered
reg delete "HKCU\Software\Classes\acestream" /f >nul 2>&1

echo.
echo Shutting down WSL...
wsl --shutdown

echo Unregistering Ubuntu distro...
wsl --unregister Ubuntu

:: Removing aceman only needs the distro gone. Uninstalling the WSL app itself
:: is separate and optional - answer N to keep it if you use WSL for anything
:: else, or want a re-install to skip the reboot (install.bat detects WSL is
:: still enabled and goes straight to provisioning).
echo.
choice /c YN /m "Also uninstall the WSL app itself (removes WSL for ALL distros)"
if not errorlevel 2 (
    echo Uninstalling the WSL app...
    wsl --uninstall
) else (
    echo Keeping the WSL app. A re-install will skip the reboot.
)

echo.
echo === Uninstall complete. ===
echo You may also delete leftover files manually:
echo   %%USERPROFILE%%\.wslconfig
echo   %%LOCALAPPDATA%%\Packages\CanonicalGroupLimited*
pause
exit /b
