[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$python = Join-Path $taskRoot '.venv\Scripts\python.exe'
$runtime = Join-Path $taskRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$existing = Get-NetTCPConnection -State Listen -LocalPort 8189 -ErrorAction SilentlyContinue
if ($existing) {
    throw 'Port 8189 is already occupied. Existing processes were left running; inspect runtime/proxy-process.json and /api/v2/health.'
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$stdout = Join-Path $runtime "proxy-$stamp.stdout.log"
$stderr = Join-Path $runtime "proxy-$stamp.stderr.log"
$state = Join-Path $runtime 'state'
$arguments = @('-X', 'utf8', '-m', 'comfy_api_proxy.cli', 'run', '--comfyui', 'http://127.0.0.1:8188', '--host', '127.0.0.1', '--port', '8189', '--state-dir', ('"' + $state + '"'))
$process = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$record = [ordered]@{ launcher_pid = $process.Id; launcher_start_utc = $process.StartTime.ToUniversalTime().ToString('o'); listener_pid = $null; listener_start_utc = $null; url = 'http://127.0.0.1:8189'; upstream = 'http://127.0.0.1:8188'; arguments = $arguments; stdout = $stdout; stderr = $stderr }
$recordPath = Join-Path $runtime 'proxy-process.json'
$record | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $recordPath
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8189/api/v2/health' -TimeoutSec 2
        $listener = Get-NetTCPConnection -State Listen -LocalPort 8189 -ErrorAction Stop | Select-Object -First 1
        $listenerProcess = Get-Process -Id $listener.OwningProcess
        $record.listener_pid = $listenerProcess.Id
        $record.listener_start_utc = $listenerProcess.StartTime.ToUniversalTime().ToString('o')
        $record.health = $health
        $record | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $recordPath
        $record | ConvertTo-Json -Depth 6
        exit 0
    } catch {
        if ($process.HasExited) { throw "Proxy exited. See $stderr" }
        Start-Sleep -Milliseconds 500
    }
}
throw "Proxy health not ready. Process was left running; inspect $recordPath and logs."
