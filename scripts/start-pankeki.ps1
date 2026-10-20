param([int]$Port = 8190, [string]$ComfyUrl = 'http://127.0.0.1:8188')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonExe)) { throw '프로젝트 Python이 없습니다. scripts\setup-app.ps1을 실행하세요.' }
Set-Location -LiteralPath $projectRoot
& $pythonExe -m pankeki serve --port $Port --comfy-url $ComfyUrl
if ($LASTEXITCODE -ne 0) { throw "Pankeki exit: $LASTEXITCODE" }
