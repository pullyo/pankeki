param([string]$Python = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!(Test-Path -LiteralPath $Python)) { throw 'Python 3.12 실행 파일을 -Python 인수로 지정하세요. WindowsApps 별칭은 사용하지 않습니다.' }
$venvPath = Join-Path $projectRoot '.venv'
if (!(Test-Path -LiteralPath (Join-Path $venvPath 'Scripts\python.exe'))) {
    & $Python -m venv $venvPath
    if ($LASTEXITCODE -ne 0) { throw 'venv 생성 실패' }
}
& (Join-Path $venvPath 'Scripts\python.exe') -m pip install -r (Join-Path $projectRoot 'requirements-lock.txt')
if ($LASTEXITCODE -ne 0) { throw '의존성 설치 실패' }
