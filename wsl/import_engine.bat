@echo off
setlocal EnableExtensions

:: import_engine.bat - find the Ace Stream engine tarball in your Windows
:: Downloads and install it into the WSL clone as engine.tar.gz. Runs
:: import_engine.sh inside WSL against your Windows Downloads folder. If the
:: tarball isn't there yet, the script prints the URL and waits - download it
:: in your browser, then press Enter in this window to finish.

:: Resolve %UserProfile%\Downloads to a WSL path (/mnt/c/...).
set "WINDL=%UserProfile%\Downloads"
set "WSLDL="
for /f "delims=" %%i in ('wsl -d Ubuntu -- wslpath -a "%WINDL%" 2^>nul') do set "WSLDL=%%i"
if not defined WSLDL (
    echo Could not resolve your Windows Downloads folder in WSL.
    pause
    exit /b 1
)

:: Guard the clone + script (the Windows kit and in-WSL clone update separately)
:: and run via `bash <script>` so we don't depend on the clone's exec bit.
wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - is the guest provisioned? Run install.bat first.'; exit 0; }; if [ -f import_engine.sh ]; then ACE_DOWNLOADS='%WSLDL%' bash import_engine.sh; else echo 'aceman: import_engine.sh is missing from your WSL clone (it predates this feature). Run update.bat to refresh the clone, then retry.'; fi"
echo.
pause
exit /b
