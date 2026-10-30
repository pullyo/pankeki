# 이전 진입점 (호환용). 실제 실행은 프로젝트 루트의 Pankeki.cmd (scripts\run_windows.py) 가 한다.
param([int]$Port = 8190, [string]$ComfyUrl = 'http://127.0.0.1:8188', [switch]$EditorOnly, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Write-Warning 'start-pankeki.ps1 은 Pankeki.cmd 로 바뀌었습니다.'
if ($ComfyUrl -ne 'http://127.0.0.1:8188') { Write-Warning '사용자 지정 ComfyUrl 은 더 이상 지원하지 않습니다. Pankeki.cmd 가 ComfyUI 를 직접 시작합니다.' }
$arguments = @('--port', "$Port")
if ($EditorOnly) { $arguments += '--editor-only' }
if ($NoBrowser) { $arguments += '--no-browser' }
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'Pankeki.cmd') @arguments
exit $LASTEXITCODE
