# 이전 진입점 (호환용). 실제 준비는 scripts\setup-windows.ps1 이 한다.
# 예전 기본값(C:\Users\Administrator\... 고정 Python, .venv)은 다른 PC에서 동작하지 않아 제거했다.
param([string]$Python = $env:PANKEKI_PYTHON)
$ErrorActionPreference = 'Stop'
Write-Warning 'setup-app.ps1 은 setup-windows.ps1 로 바뀌었습니다. 편집 환경(.venv-windows-editor)을 준비합니다.'
$arguments = @{}
if ($Python) { $arguments['Python'] = $Python }
& (Join-Path $PSScriptRoot 'setup-windows.ps1') @arguments
