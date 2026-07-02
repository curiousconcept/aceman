@echo off
setlocal EnableExtensions

:: restore_from_downloads.bat - restore aceman favourites from a backup folder
:: in your Windows Downloads (made by backup_to_downloads.bat) back into WSL.
:: Runs restore_from_downloads.sh inside WSL against your Windows Downloads;
:: with no arg it restores the newest aceman-backup-* folder there.

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
wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - nothing to restore into.'; exit 0; }; if [ -f restore_from_downloads.sh ]; then ACE_DOWNLOADS='%WSLDL%' bash restore_from_downloads.sh; else echo 'aceman: restore_from_downloads.sh is missing from your WSL clone (it predates this feature). Run update.bat to refresh the clone, then retry.'; fi"
echo.
pause
exit /b
