@echo off
REM Install the native messaging host for LinkedIn Profile Schmusher (Windows)
REM Usage: install-windows.bat <chrome-extension-id>
REM
REM To find your extension ID:
REM   1. Go to chrome://extensions
REM   2. Find "LinkedIn Profile Schmusher"
REM   3. Copy the ID

if "%~1"=="" (
    echo Usage: install-windows.bat ^<chrome-extension-id^>
    echo.
    echo Find your extension ID at chrome://extensions
    exit /b 1
)

set EXT_ID=%~1
set HOST_NAME=com.schmusher.host
set SCRIPT_DIR=%~dp0
set HOST_BAT=%SCRIPT_DIR%schmusher_host.bat
set HOST_PY=%SCRIPT_DIR%schmusher_host.py
set MANIFEST=%SCRIPT_DIR%%HOST_NAME%.json

REM Create the .bat wrapper for Python
echo @echo off > "%HOST_BAT%"
echo python "%HOST_PY%" >> "%HOST_BAT%"

REM Create the manifest with correct paths (escape backslashes for JSON)
set MANIFEST_PATH=%HOST_BAT:\=\\%

echo { > "%MANIFEST%"
echo   "name": "%HOST_NAME%", >> "%MANIFEST%"
echo   "description": "LinkedIn Profile Schmusher native host", >> "%MANIFEST%"
echo   "path": "%MANIFEST_PATH%", >> "%MANIFEST%"
echo   "type": "stdio", >> "%MANIFEST%"
echo   "allowed_origins": [ >> "%MANIFEST%"
echo     "chrome-extension://%EXT_ID%/" >> "%MANIFEST%"
echo   ] >> "%MANIFEST%"
echo } >> "%MANIFEST%"

REM Register in Windows Registry (current user)
reg add "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /d "%MANIFEST%" /f

echo.
echo Installed native messaging host:
echo   Manifest: %MANIFEST%
echo   Host:     %HOST_BAT%
echo   Extension ID: %EXT_ID%
echo.
echo Restart Chrome for changes to take effect.
