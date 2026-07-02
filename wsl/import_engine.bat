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

wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman && ACE_DOWNLOADS='%WSLDL%' ./import_engine.sh"
echo.
pause
exit /b
