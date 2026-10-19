@echo off
cd /d "%~dp0"
echo Building the Windows installer (release\windows) ...
call npm install --legacy-peer-deps
call npm run dist:win
pause
