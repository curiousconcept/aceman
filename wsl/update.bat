@echo off
setlocal EnableExtensions
title aceman update

set "BRANCH=%~1"

echo ============================================================
echo  Update aceman
echo ------------------------------------------------------------
echo  Force-updates the WSL project (~/Projects/aceman): fetches
echo  GitHub and hard-resets to the latest code. Any local edits
echo  to the repo are discarded. Your favourites are NOT in the
echo  repo (they live in ~/.config/aceman), so they are kept.
if defined BRANCH (
    echo  Target branch: %BRANCH%
) else (
    echo  Target branch: current ^(or main^)
)
echo ============================================================
echo.
echo  TRUST NOTE: this pulls code from the internet that will run
echo  on your machine on the next launch. Only proceed if you trust
echo  the project author and have reviewed the repository:
echo.
echo      https://github.com/curiousconcept/aceman
echo.
choice /c YN /m "Update now (discards local repo edits)"
if errorlevel 2 (
    echo Cancelled. Nothing changed.
    pause
    exit /b
)

echo.
echo Updating...
:: Force-pull inline via git, NOT by calling ./update.sh - update is the tool
:: you run to escape a stale clone, so it must not depend on any file being in
:: that clone (a clone old enough to lack update.sh is exactly when you need
:: this). Mirrors update.sh: fetch, then hard-reset the branch to origin. No
:: inner double quotes (cmd would eat them); branch names have no spaces, so
:: bare $B is safe, and `case` handles the empty/detached cases quote-free.
wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman 2>/dev/null || { echo 'aceman: ~/Projects/aceman not found - run install.bat first.'; exit 1; }; B='%BRANCH%'; B=${B:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null)}; case $B in HEAD|'') B=main ;; esac; echo updating to origin/$B ...; git fetch origin $B && git reset --hard && git checkout -B $B origin/$B"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo Update complete. Launch with run.bat or the Desktop shortcut.
) else (
    echo Update did not complete cleanly ^(exit %RC%^). Check your internet
    echo connection, or that the branch name is correct. Open Ubuntu to look:
    echo     cd ~/Projects/aceman ^&^& git status
)
pause
exit /b
