@echo off
set "WEBVIEW2_USER_DATA_FOLDER=%LOCALAPPDATA%\com.melih.metaframe-studio\EBWebView"
cd /d "%~dp0src-tauri"
start "" "%~dp0src-tauri\target\debug\metaframe-studio.exe"
