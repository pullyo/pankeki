@echo off
rem Pankeki for Windows: ComfyUI(8188) + app(8190). Options: --editor-only --cpu --no-browser
rem Prepare first: powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 [-Generation] [-Models]
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
set "PANKEKI_PY=.venv-windows-editor\Scripts\python.exe"
if exist ".venv-windows\Scripts\python.exe" set "PANKEKI_PY=.venv-windows\Scripts\python.exe"
for %%A in (%*) do if /I "%%~A"=="--editor-only" set "PANKEKI_PY=.venv-windows-editor\Scripts\python.exe"
if not exist "%PANKEKI_PY%" (
  echo 실행 환경이 없습니다. 먼저 이 폴더에서 다음을 실행하세요:
  echo   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
  pause
  exit /b 1
)
"%PANKEKI_PY%" scripts\run_windows.py %*
set "PANKEKI_EXIT=%ERRORLEVEL%"
if not "%PANKEKI_EXIT%"=="0" pause
exit /b %PANKEKI_EXIT%
