<#
.SYNOPSIS
  Pankeki Windows 10/11 x64 준비 스크립트 (setup-macos.sh 와 같은 단계).

.DESCRIPTION
  기본: 편집 전용 환경 .venv-windows-editor (requirements.txt).
  -Generation : vendor\ComfyUI(고정 commit) + .venv-windows (torch 2.14.1 CUDA 13.0, 없으면 -Cpu 필요)
  -Sdxl       : -Generation + SDXL Base (~6.9 GB, SHA256 검증)
  -Models     : -Generation + 제품 모델 3종 (~19 GB, SHA256 검증)
  -Mcp        : Codex/Claude 연결용 MCP 전용 환경 runtime\windows\pankeki-mcp
  -Cpu        : NVIDIA GPU 없이 CPU 용 torch 설치 (생성은 매우 느림)
  기존 venv·ComfyUI·모델은 덮어쓰지 않는다. 다른 commit 의 ComfyUI 가 있으면 중단한다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Generation -Models -Mcp
#>
[CmdletBinding()]
param(
    [string]$Python = $env:PANKEKI_PYTHON,
    [switch]$Generation,
    [switch]$Sdxl,
    [switch]$Models,
    [switch]$Mcp,
    [switch]$Cpu,
    [string]$CudaIndex = 'https://download.pytorch.org/whl/cu130'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$ComfyCommit = '8f04fd6ecf4a548937971e840af2a985529fab76'
$ComfyArchive = if ($env:PANKEKI_COMFY_ARCHIVE_URL) { $env:PANKEKI_COMFY_ARCHIVE_URL } else { "https://github.com/Comfy-Org/ComfyUI/archive/$ComfyCommit.zip" }
$TorchVersion = '2.14.1'
$TorchvisionVersion = '0.29.1'
$editorPy = Join-Path $root '.venv-windows-editor\Scripts\python.exe'
$genPy = Join-Path $root '.venv-windows\Scripts\python.exe'
$pipCache = Join-Path $root 'runtime\windows\pip-cache'
if ($Sdxl -or $Models) { $Generation = $true }

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "명령 실패 ($LASTEXITCODE): $Exe $($Arguments -join ' ')" }
}

function Test-PythonVersion([string]$Exe) {
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $false }
    # The Microsoft Store alias in WindowsApps opens the Store instead of running Python.
    if ($Exe -like '*\WindowsApps\*') { return $false }
    & $Exe -c 'import sys; raise SystemExit(0 if (3,12) <= sys.version_info[:2] <= (3,13) and sys.maxsize > 2**32 else 1)' 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Find-Python {
    if ($Python) {
        if (Test-PythonVersion $Python) { return $Python }
        throw "지정한 Python 이 3.12/3.13 64비트가 아닙니다: $Python"
    }
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        foreach ($version in @('3.12', '3.13')) {
            $found = & $launcher.Source "-$version" -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0 -and (Test-PythonVersion ($found | Select-Object -Last 1))) { return ($found | Select-Object -Last 1) }
        }
    }
    foreach ($candidate in @(Get-Command python.exe -All -ErrorAction SilentlyContinue)) {
        if (Test-PythonVersion $candidate.Source) { return $candidate.Source }
    }
    foreach ($candidate in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
                             "$env:ProgramFiles\Python312\python.exe", "$env:ProgramFiles\Python313\python.exe")) {
        if (Test-PythonVersion $candidate) { return $candidate }
    }
    throw 'Python 3.12 또는 3.13 (64비트)을 찾지 못했습니다. https://www.python.org 에서 설치하거나 -Python 으로 경로를 지정하세요.'
}

function Get-ComfyCommit([string]$Dir) {
    $marker = Join-Path $Dir '.pankeki-comfy-commit'
    if (Test-Path -LiteralPath $marker) { return (Get-Content -LiteralPath $marker -Raw).Trim() }
    $head = Join-Path $Dir '.git\HEAD'
    if (-not (Test-Path -LiteralPath $head)) { return '' }
    $value = (Get-Content -LiteralPath $head -Raw).Trim()
    if ($value -notlike 'ref:*') { return $value }
    $ref = $value.Substring(4).Trim()
    $refFile = Join-Path $Dir ('.git\' + $ref.Replace('/', '\'))
    if (Test-Path -LiteralPath $refFile) { return (Get-Content -LiteralPath $refFile -Raw).Trim() }
    return ''
}

function Test-ComfySources([string]$Root) {
    & $editorPy -c 'import sys; from pankeki.comfy_adapter import _atomic_sources, ATOMIC_CANCEL_SOURCE_PINS as P; sys.exit(0 if _atomic_sources(sys.argv[1]) == P else 1)' $Root 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Install-Comfy {
    $target = Join-Path $root 'vendor\ComfyUI'
    if (Test-Path -LiteralPath (Join-Path $target 'main.py')) {
        $found = Get-ComfyCommit $target
        if ($found -and $found -ne $ComfyCommit) { throw "vendor\ComfyUI 가 다른 commit($found)입니다. 덮어쓰지 않고 중단합니다. 필요한 commit: $ComfyCommit" }
        if (-not (Test-ComfySources $root)) { throw "vendor\ComfyUI 의 핵심 파일이 고정 commit $ComfyCommit 과 다릅니다. 덮어쓰지 않고 중단합니다." }
        Write-Output 'ComfyUI 확인 완료 (고정 commit).'
        return
    }
    if (Test-Path -LiteralPath $target) { throw 'vendor\ComfyUI 폴더가 있지만 main.py 가 없습니다. 덮어쓰지 않고 중단합니다.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'vendor') | Out-Null
    $staging = Join-Path $root ('vendor\.comfyui-download-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path (Join-Path $staging 'vendor') | Out-Null
    try {
        $zip = Join-Path $staging 'comfyui.zip'
        Write-Output "ComfyUI $ComfyCommit 내려받는 중…"
        Invoke-Checked "$env:SystemRoot\System32\curl.exe" @('--fail', '--location', '--retry', '3', '--silent', '--show-error', '--output', $zip, $ComfyArchive)
        Expand-Archive -LiteralPath $zip -DestinationPath $staging
        $extracted = Join-Path $staging "ComfyUI-$ComfyCommit"
        $staged = Join-Path $staging 'vendor\ComfyUI'
        Move-Item -LiteralPath $extracted -Destination $staged
        Set-Content -LiteralPath (Join-Path $staged '.pankeki-comfy-commit') -Value $ComfyCommit -Encoding ascii
        if (-not (Test-Path -LiteralPath (Join-Path $staged 'main.py')) -or -not (Test-ComfySources $staging)) {
            throw "내려받은 ComfyUI 가 고정 commit $ComfyCommit 과 일치하지 않습니다. 설치하지 않았습니다."
        }
        Move-Item -LiteralPath $staged -Destination $target
        Write-Output 'ComfyUI 준비 완료.'
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    }
}

# 1) Editor environment
if (-not (Test-Path -LiteralPath $editorPy)) {
    $base = Find-Python
    Write-Output "Python: $base"
    Invoke-Checked $base @('-m', 'venv', (Join-Path $root '.venv-windows-editor'))
}
New-Item -ItemType Directory -Force -Path $pipCache | Out-Null
Invoke-Checked $editorPy @('-m', 'pip', 'install', '--disable-pip-version-check', '--cache-dir', $pipCache, '-r', (Join-Path $root 'requirements.txt'))

# 2) Generation environment
if ($Generation) {
    $nvidia = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $nvidia -and -not $Cpu) {
        throw 'NVIDIA GPU 드라이버(nvidia-smi)를 찾지 못했습니다. 편집 환경은 준비됐습니다. GPU 없이 CPU 로 생성하려면 -Cpu 를 붙여 다시 실행하세요(매우 느림).'
    }
    Install-Comfy
    if (-not (Test-Path -LiteralPath $genPy)) {
        $base = (& $editorPy -c 'import sys; print(sys._base_executable)').Trim()
        Invoke-Checked $base @('-m', 'venv', (Join-Path $root '.venv-windows'))
    }
    $index = if ($Cpu -and -not $nvidia) { 'https://download.pytorch.org/whl/cpu' } else { $CudaIndex }
    Write-Output "torch $TorchVersion 설치 ($index, 약 2.5 GB)…"
    Invoke-Checked $genPy @('-m', 'pip', 'install', '--disable-pip-version-check', '--cache-dir', $pipCache,
        "torch==$TorchVersion", "torchvision==$TorchvisionVersion", '--index-url', $index)
    # Keep the CUDA build: ComfyUI lists torch/torchvision unpinned, and PyPI would offer the CPU build.
    $constraints = Join-Path $root 'runtime\windows\torch-constraints.txt'
    Set-Content -LiteralPath $constraints -Value @("torch==$TorchVersion", "torchvision==$TorchvisionVersion") -Encoding ascii
    Invoke-Checked $genPy @('-m', 'pip', 'install', '--disable-pip-version-check', '--cache-dir', $pipCache, '-c', $constraints,
        '-r', (Join-Path $root 'requirements.txt'), '-r', (Join-Path $root 'vendor\ComfyUI\requirements.txt'))
    & $genPy -c 'import torch, json; print(json.dumps({"torch": torch.__version__, "cuda_build": torch.version.cuda, "cuda_available": torch.cuda.is_available(), "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))'
}

# 3) Models (SHA256-verified; existing verified files are kept, not downloaded again)
if ($Models) {
    Invoke-Checked $genPy @('-u', (Join-Path $root 'scripts\restore_models_macos.py'), '--model', 'product')
} elseif ($Sdxl) {
    Invoke-Checked $genPy @('-u', (Join-Path $root 'scripts\restore_models_macos.py'), '--model', 'sdxl-base')
}

# 4) MCP runtime for the Codex/Claude chat connection
if ($Mcp) {
    $plugin = Join-Path $root 'plugins\pankeki-local\scripts'
    Invoke-Checked $editorPy @((Join-Path $plugin 'configure_paths.py'))
    Invoke-Checked $editorPy @((Join-Path $plugin 'setup_runtime.py'))
}

Write-Output '준비 완료. Pankeki.cmd 를 실행하세요 (GPU 없이 편집만: Pankeki.cmd --editor-only).'
