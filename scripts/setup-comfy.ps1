[CmdletBinding()]
param(
    [string]$Python = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
    [switch]$InstallDependencies,
    [switch]$DownloadModel,
    [switch]$Start,
    [switch]$Inspect,
    [switch]$EnableCropAndStitch,
    [int]$Port = 8188,
    [ValidateRange(1, 50)][int]$ReadyTimeoutSeconds = 45
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$comfyRoot = Join-Path $projectRoot 'vendor\ComfyUI'
$comfyPython = Join-Path $projectRoot '.venv-comfy\Scripts\python.exe'
$evidenceDir = Join-Path $projectRoot 'evidence'
$modelsDir = Join-Path $projectRoot 'models'
$checkpointDir = Join-Path $modelsDir 'checkpoints'
$comfyCommit = '8f04fd6ecf4a548937971e840af2a985529fab76'
$modelSha256 = '3f067a1b943cf162f2b8f8588f6cf5824bd5b4c7d1d88d87164b9ca123616549'
$modelRevision = 'b261bac6fd2cf515557d5d0707481eafa0485ec2'
foreach ($directory in @($evidenceDir, $checkpointDir)) {
    if (!(Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Executable" }
}

function Get-OwnedComfyListener([string]$RecordPath) {
    # Query the socket-owning process, because Windows venv launchers create children.
    $probe = @'
import datetime, json, pathlib, sys, time, urllib.error, urllib.request
import psutil
record = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
launcher_id = record.get("launcher_pid", record["pid"])
expected_created = datetime.datetime.fromisoformat(record["process_start_time_utc"].replace("Z", "+00:00")).timestamp()
deadline = time.monotonic() + int(sys.argv[2])
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
last_error = "No owned listener is ready."
while time.monotonic() < deadline:
    launcher = psutil.Process(launcher_id)
    if abs(launcher.create_time() - expected_created) > 0.01:
        raise RuntimeError("Saved launcher PID has been reused by another process.")
    owned_ids = {launcher_id, *(p.pid for p in launcher.children(recursive=True))}
    listeners = [c for c in psutil.net_connections(kind="tcp")
                 if c.status == psutil.CONN_LISTEN and c.laddr.port == record["port"]
                 and c.laddr.ip == "127.0.0.1"]
    for connection in listeners:
        if connection.pid not in owned_ids:
            raise RuntimeError("The listening process is not owned by this launcher.")
        process = psutil.Process(connection.pid)
        try:
            with opener.open(record["url"] + "/system_stats", timeout=2) as response:
                stats = json.load(response)
            version = stats["system"]["comfyui_version"]
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as error:
            last_error = str(error)
            continue
        created = process.create_time()
        print(json.dumps({"launcher_pid": launcher_id, "listener_pid": process.pid,
                          "listener_created_unix": created,
                          "listener_created_utc": datetime.datetime.fromtimestamp(created, datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
                          "listener_is_launcher_descendant": process.pid != launcher_id,
                          "address": connection.laddr.ip, "port": connection.laddr.port,
                          "url": record["url"], "comfyui_version": version, "health_ready": True}))
        sys.exit(0)
    time.sleep(0.25)
raise TimeoutError("ComfyUI did not become healthy: " + last_error)
'@
    $output = & $comfyPython -c $probe $RecordPath "$ReadyTimeoutSeconds"
    if ($LASTEXITCODE -ne 0) { throw 'Could not confirm the owned ComfyUI listener. Processes were preserved; inspect the recorded logs.' }
    return ($output | ConvertFrom-Json)
}

if ($InstallDependencies) {
    if (!(Test-Path -LiteralPath $comfyRoot)) {
        Invoke-Checked 'git' @('clone', '--no-checkout', 'https://github.com/Comfy-Org/ComfyUI.git', $comfyRoot)
        Invoke-Checked 'git' @('-C', $comfyRoot, 'checkout', '--detach', $comfyCommit)
    }
    $currentCommit = & git -c "safe.directory=$($comfyRoot.Replace('\','/'))" -C $comfyRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $currentCommit.Trim() -ne $comfyCommit) {
        throw "Existing ComfyUI does not match pinned commit $comfyCommit. It was preserved."
    }
    if (!(Test-Path -LiteralPath $comfyPython)) {
        Invoke-Checked $Python @('-m', 'venv', (Join-Path $projectRoot '.venv-comfy'))
    }
    $lockfile = Join-Path $evidenceDir 'environment-pip-freeze.txt'
    if (Test-Path -LiteralPath $lockfile) {
        Invoke-Checked $comfyPython @('-m', 'pip', 'install', '-r', $lockfile, '--extra-index-url', 'https://download.pytorch.org/whl/cu130')
    } else {
        Invoke-Checked $comfyPython @('-m', 'pip', 'install', 'torch', 'torchvision', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cu130')
        Invoke-Checked $comfyPython @('-m', 'pip', 'install', '-r', (Join-Path $comfyRoot 'requirements.txt'))
    }
    Invoke-Checked $comfyPython @((Join-Path $evidenceDir 'environment-inspect.py'))
}

if ($DownloadModel) {
    $checkpoint = Join-Path $checkpointDir 'sd_turbo.safetensors'
    if (!(Test-Path -LiteralPath $checkpoint)) {
        $partial = "$checkpoint.download"
        Invoke-Checked 'curl.exe' @('--fail', '--location', '--retry', '3', '--continue-at', '-', "https://huggingface.co/stabilityai/sd-turbo/resolve/$modelRevision/sd_turbo.safetensors", '--output', $partial)
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelSha256) {
            throw 'Downloaded checkpoint does not match the publisher SHA-256. Partial file preserved; not activated.'
        }
        Move-Item -LiteralPath $partial -Destination $checkpoint
    }
    if ((Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelSha256) {
        throw 'Existing checkpoint does not match the pinned publisher SHA-256. Existing file preserved.'
    }
    foreach ($item in @(@('LICENSE.md', 'sd-turbo-LICENSE.md'), @('README.md', 'sd-turbo-README.md'))) {
        $target = Join-Path $modelsDir $item[1]
        if (!(Test-Path -LiteralPath $target)) {
            Invoke-Checked 'curl.exe' @('--fail', '--location', "https://huggingface.co/stabilityai/sd-turbo/raw/$modelRevision/$($item[0])", '--output', $target)
        }
    }
    Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256 | Format-List
}

if ($Start) {
    if (!(Test-Path -LiteralPath $comfyPython)) { throw 'Run -InstallDependencies first.' }
    $portOccupied = & $comfyPython -c 'import psutil,sys; print(any(c.status == psutil.CONN_LISTEN and c.laddr and c.laddr.port == int(sys.argv[1]) for c in psutil.net_connections(kind="tcp")))' "$Port"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect local listeners. Existing processes were preserved.' }
    if ($portOccupied.Trim() -eq 'True') { throw "Port $Port is already in use. Existing processes were preserved." }
    $pathConfig = Join-Path $projectRoot 'vendor\pankeki-model-paths.yaml'
    $arguments = @('main.py', '--listen', '127.0.0.1', '--port', "$Port", '--offline', '--disable-all-custom-nodes', '--use-pytorch-cross-attention', '--fp16-unet', '--fp16-text-enc', '--fp32-vae', '--preview-method', 'latent2rgb', '--extra-model-paths-config', $pathConfig)
    if ($EnableCropAndStitch) {
        $cropPath = Join-Path $projectRoot 'integrations\github\sources\ComfyUI-Inpaint-CropAndStitch'
        if (!(Test-Path -LiteralPath $cropPath)) { throw 'The pinned CropAndStitch source is missing.' }
        $arguments += @('--whitelist-custom-nodes', 'ComfyUI-Inpaint-CropAndStitch')
    }
    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $evidenceDir "environment-comfy-$runStamp.stdout.log"
    $stderr = Join-Path $evidenceDir "environment-comfy-$runStamp.stderr.log"
    # Quote each argument as Windows command-line data; these values contain no embedded quotes.
    $argumentLine = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $process = Start-Process -FilePath $comfyPython -WorkingDirectory $comfyRoot -ArgumentList $argumentLine -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $record = [ordered]@{
        owner = 'Pankeki setup-comfy.ps1'
        pid = $process.Id
        launcher_pid = $process.Id
        listener_pid = $null
        health_ready = $false
        process_start_time_utc = $process.StartTime.ToUniversalTime().ToString('o')
        executable = $comfyPython
        working_directory = $comfyRoot
        arguments = $arguments
        port = $Port
        url = "http://127.0.0.1:$Port"
        stdout = $stdout
        stderr = $stderr
        comfy_commit = $comfyCommit
        custom_nodes = @($(if ($EnableCropAndStitch) { 'ComfyUI-Inpaint-CropAndStitch' }))
    }
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidenceDir 'environment-comfy-process.json') -Encoding utf8
    Write-Output "Started ComfyUI launcher PID $($process.Id); waiting for its server listener."
    Write-Output "Logs: $stdout ; $stderr"
}
if ($Start -or $Inspect) {
    $recordPath = Join-Path $evidenceDir 'environment-comfy-process.json'
    if (!(Test-Path -LiteralPath $recordPath)) { throw 'No owned ComfyUI launch record exists.' }
    $listener = Get-OwnedComfyListener $recordPath
    $listener | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidenceDir 'environment-listener.json') -Encoding utf8
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $record.custom_nodes = @($record.custom_nodes)
    foreach ($name in @('launcher_pid', 'listener_pid', 'listener_created_utc', 'listener_created_unix', 'health_ready')) {
        $record | Add-Member -NotePropertyName $name -NotePropertyValue $listener.$name -Force
    }
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $recordPath -Encoding utf8
    Write-Output "ComfyUI ready at $($listener.url). Listening PID: $($listener.listener_pid); launcher PID: $($listener.launcher_pid)."
    Write-Output "Use prepare_manifest.py --pid $($listener.listener_pid)"
}
if (!$InstallDependencies -and !$DownloadModel -and !$Start -and !$Inspect) {
    Write-Output 'Use -InstallDependencies, -DownloadModel, -Start, or -Inspect. -Inspect checks the recorded server without starting or stopping a process.'
}
