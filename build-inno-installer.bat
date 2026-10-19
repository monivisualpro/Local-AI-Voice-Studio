@echo off
setlocal enabledelayedexpansion
title Building Local AI Voice Studio Setup .EXE - Moni Visual Pro

echo =========================================================================
echo       LOCAL AI TTS WORKSTATION - INNO SETUP (.EXE) COMPILER
echo                  Develop by Moni Visual Pro
echo =========================================================================
echo.

:: Always run from the folder that contains this script
cd /d "%~dp0"
:: NOTE: this folder path can contain characters such as "(4)" - inside
:: parenthesised IF blocks percent-expansion of such a path breaks cmd's parser,
:: therefore delayed expansion (!VAR!) is used inside blocks.
set "ISS_SCRIPT=%~dp0installer.iss"

:: 1. Verify Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo [1/6] Checking npm packages...
:: Electron / electron-builder downloads use GitHub by default and are cached in
::   %LOCALAPPDATA%\electron\Cache  and  %LOCALAPPDATA%\electron-builder\Cache
:: Only the very first build needs network access for these.
::
:: OPTIONAL MIRROR: if GitHub is unreachable from your network, uncomment the two
:: lines below. WARNING: an unreachable mirror makes the build fail with
:: "connect ETIMEDOUT", and switching mirrors also bypasses the existing download
:: cache (the cache key is derived from the download URL). Only enable it when the
:: mirror is actually reachable.
:: set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
:: set "ELECTRON_CUSTOM_DIR={{ version }}"

if not exist "node_modules\vite" (
    echo Installing node dependencies...
    call npm install --legacy-peer-deps
    if errorlevel 1 (
        echo Retrying npm install with --force...
        call npm install --force
    )
)

REM Verify electron & electron-builder are available for step 4
if not exist "node_modules\electron-builder" (
    echo Installing Electron desktop builder tools...
    call npm install -D electron electron-builder concurrently wait-on --legacy-peer-deps
    if errorlevel 1 (
        echo [ERROR] Failed to install Electron build dependencies.
        pause
        exit /b 1
    )
)

echo.
echo [2/6] Verifying brand icon assets (public\icon.png + public\favicon.ico)...
call :ensureIcons
if not exist "public\icon.png" (
    echo [ERROR] public\icon.png is required by electron-builder but is missing.
    pause
    exit /b 1
)
if not exist "public\favicon.ico" (
    echo [ERROR] public\favicon.ico is required by installer.iss but is missing.
    pause
    exit /b 1
)

echo.
echo [3/6] Seeding the Electron cache + compiling web assets with Vite...

:: Electron Builder looks for the Electron zip in
::   %LOCALAPPDATA%\electron-builder\Cache\electron
:: If the same zip was already downloaded by the "electron" npm package into
:: %LOCALAPPDATA%\electron\Cache, copy it across so electron-builder does not
:: have to download ~160 MB a second time.
set "EB_ELECTRON_CACHE=%LOCALAPPDATA%\electron-builder\Cache\electron"
if not exist "%EB_ELECTRON_CACHE%" mkdir "%EB_ELECTRON_CACHE%" 2>nul
for %%z in ("%LOCALAPPDATA%\electron\Cache\electron-v*-win32-x64.zip") do (
    if exist "%%~z" (
        if not exist "!EB_ELECTRON_CACHE!\%%~nxz" (
            echo [INFO] Detected cached Electron zip: %%~nxz
            echo Copying it into the Electron-Builder cache directory...
            copy /y "%%~z" "!EB_ELECTRON_CACHE!\" >nul
        )
    )
)

call npm run build
if errorlevel 1 (
    echo [ERROR] Vite build failed!
    pause
    exit /b 1
)

echo.
echo [4/6] Packaging Electron binaries into release\windows\win-unpacked\ ...
echo [INFO] The first run downloads Electron + winCodeSign; this can take minutes.
call npx electron-builder --win --dir --config electron-builder.json -c.directories.output=release/windows
if errorlevel 1 (
    echo [ERROR] electron-builder failed - read the messages above.
    pause
    exit /b 1
)

if not exist "release\windows\win-unpacked\Local AI Voice Studio.exe" (
    echo [ERROR] release\windows\win-unpacked\Local AI Voice Studio.exe was not produced.
    pause
    exit /b 1
)

echo.
echo [5/6] Searching for Inno Setup 6 Compiler (ISCC.exe)...
set "ISCC_PATH="

REM Common default installation paths for Inno Setup 6 & 5
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
    set "ISCC_PATH=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
) else if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" (
    set "ISCC_PATH=%ProgramFiles%\Inno Setup 6\ISCC.exe"
) else if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" (
    set "ISCC_PATH=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
) else (
    where ISCC.exe >nul 2>nul
    if not errorlevel 1 set "ISCC_PATH=ISCC.exe"
)

REM Registry fallback - covers non-default install locations
if not defined ISCC_PATH (
    for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1" /v InstallLocation 2^>nul ^| findstr /i "InstallLocation"') do set "ISCC_PATH=%%BISCC.exe"
)

if not defined ISCC_PATH (
    echo.
    echo [NOTICE] ISCC.exe - Inno Setup 6 - was not found on this machine.
    echo Install it from https://jrsoftware.org/isdl.php and run this file again.
    echo Or open 'installer.iss' in the Inno Setup GUI and press Ctrl + F9.
    echo.
    echo File path: !ISS_SCRIPT!
    echo.
    pause
    exit /b 1
)

echo Found Inno Setup Compiler at: "!ISCC_PATH!"
echo.
echo [6/6] Compiling installer.iss into Setup .EXE...
"!ISCC_PATH!" "!ISS_SCRIPT!"
if errorlevel 1 (
    echo [ERROR] Inno Setup compilation failed - read the messages above.
    pause
    exit /b 1
)

echo.
echo =========================================================================
echo [SUCCESS] Setup .EXE Installer created successfully!
echo.
echo Output Directory: %~dp0installer_output\
echo Setup Executable: Local_AI_Voice_Studio_Setup_v0.20.0.exe
echo.
echo Develop by Moni Visual Pro
echo =========================================================================
pause
exit /b 0

:: ---------------------------------------------------------------------------
:: Subroutine - create the brand icon assets when they are missing
:: ---------------------------------------------------------------------------
:ensureIcons
if exist "public\icon.png" if exist "public\favicon.ico" goto :eof
echo [INFO] public\icon.png or public\favicon.ico is missing - generating brand icons...
python "%~dp0tools\generate-icons.py"
goto :eof

