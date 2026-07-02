@echo off
setlocal EnableExtensions

:: backup_to_downloads.bat - save aceman favourites to your Windows Downloads
:: before uninstalling. Runs backup_to_downloads.sh inside WSL, pointed at your
:: Windows Downloads folder (the favourites live inside WSL; Downloads is on
:: Windows). uninstall.bat calls this (prompted); also runnable on its own.

:: Resolve %UserProfile%\Downloads to a WSL path (/mnt/c/...).
set "WINDL=%UserProfile%\Downloads"
set "WSLDL="
for /f "delims=" %%i in ('wsl -d Ubuntu -- wslpath -a "%WINDL%" 2^>nul') do set "WSLDL=%%i"
if not defined WSLDL (
    echo Could not resolve your Windows Downloads folder in WSL.
    if "%~1"=="" pause
    exit /b 1
)

:: Guard the clone + script: the Windows kit and the in-WSL git clone update
:: separately, so a fresh .bat can meet an old clone that predates this script.
:: Run via `bash <script>` (no dependence on the clone's exec bit), and skip
:: cleanly with a clear message rather than a confusing "No such file" error -
:: important since uninstall.bat calls this mid-teardown.
wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - skipping backup.'; exit 0; }; if [ -f backup_to_downloads.sh ]; then ACE_DOWNLOADS='%WSLDL%' bash backup_to_downloads.sh; else echo 'aceman: backup_to_downloads.sh is missing from your WSL clone (it predates this feature). Run update.bat to refresh the clone, then retry. Skipping backup.'; fi"
echo.
:: Any arg (e.g. uninstall.bat passing "nopause") suppresses the pause so the
:: caller keeps control; a plain double-click pauses to show the result.
if "%~1"=="" pause
exit /b
