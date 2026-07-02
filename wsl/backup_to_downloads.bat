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

wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman && ACE_DOWNLOADS='%WSLDL%' ./backup_to_downloads.sh"
echo.
:: Any arg (e.g. uninstall.bat passing "nopause") suppresses the pause so the
:: caller keeps control; a plain double-click pauses to show the result.
if "%~1"=="" pause
exit /b
