# Windows 실기 QA 절차

2026-10-29 작성. 대상 브랜치 `windows-port-20261029`. 이 문서의 단계는 아직 실제 Windows PC에서 실행되지 않았다. 각 단계의 결과는 `runtime\windows\qa\` 아래 파일로 남기고, 통과하지 않은 단계는 통과로 적지 않는다.

## 0. 읽기 전용 사전 점검 (설치·다운로드 없음)

PowerShell에서:

```powershell
$qa = 'runtime\windows\qa'; New-Item -ItemType Directory -Force $qa | Out-Null
[ordered]@{
  os = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture)
  cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfLogicalProcessors)
  ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
  gpu = (Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, AdapterRAM)
  nvidiaSmi = $(try { (& nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader) } catch { $null })
  python = $(try { (& py -0p) } catch { $null })
  node = $(try { (& node --version) } catch { $null })
  codex = (Get-Command codex -ErrorAction SilentlyContinue).Source
  claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
  freeGB = [math]::Round((Get-PSDrive (Get-Location).Drive.Name).Free / 1GB, 1)
  ports = (netstat -ano -p TCP | Select-String ':8188 |:8190 ')
} | ConvertTo-Json -Depth 4 | Set-Content "$qa\preflight.json" -Encoding utf8
```

판정: NVIDIA GPU와 VRAM 8 GB 이상이면 생성 QA, 아니면 편집 전용 QA만 한다. 남은 디스크가 30 GB 미만이면 `-Models` 대신 `-Sdxl`(약 6.9 GB)을 쓴다. 8188/8190 포트가 이미 쓰이고 있으면 무엇이 쓰는지 확인하고 멈춘다(임의로 종료하지 않는다).

## 1. 설치 (사용자 승인 후)

| 단계 | 명령 | 내려받는 양 |
|---|---|---|
| 편집 환경 | `scripts\setup-windows.ps1` | 약 60 MB |
| 생성 환경 | `scripts\setup-windows.ps1 -Generation` | ComfyUI 약 30 MB + torch CUDA 약 2.5 GB + 의존성 |
| 모델 | `-Sdxl` 또는 `-Models` | 약 6.9 GB / 약 19 GB |
| MCP | `-Mcp` | 약 30 MB |

설치 출력의 마지막 줄 JSON(`torch`, `cuda_build`, `cuda_available`, `device`)을 `qa\install.json`에 저장한다.

## 2. 실행·생성·수정 (브라우저)

1. `Pankeki.cmd --no-browser` → `qa\launch.txt`에 콘솔 출력 저장. GPU 이름 줄 또는 편집 전용 안내 줄이 있어야 한다.
2. `curl.exe -s http://127.0.0.1:8190/api/health` 와 `/api/capabilities` → `qa\health.json`, `qa\capabilities.json`.
3. 브라우저에서 SDXL Base로 1024×1024 후보 생성 → 걸린 시간, `runtime\runs\<job>\metrics.json` 경로 기록.
4. 후보에서 **이어서 수정** → 마스크 칠하고 수정 → 결과의 마스크 밖 RGB·alpha 오차(metrics) 기록.
5. 프로젝트 저장 → 앱 종료(Ctrl+C) → 재실행 → 같은 프로젝트 다시 열기 → 결과 이미지가 같은지 확인.
6. 종료 뒤 `netstat -ano -p TCP | Select-String ':8188 |:8190 '`가 비어 있어야 한다(남은 인터프리터 없음).

## 3. 데스크톱 앱

1. `cd desktop; npm ci; npm test` → `qa\desktop-test.txt` (Windows에서 단위 테스트 전체).
2. `npm start` → 앱 창이 뜨고 생성 화면까지 열리는지. 한글·공백 경로 프로젝트로 한 번 더.
3. 채팅: Codex 또는 Claude 선택 → 연결 상태 → "고양이 캐릭터 하나 만들어줘" → 이미지 도구 호출과 결과 표시.
4. 생성 중에 창 닫기 → 진행 중 작업 확인 창 → 종료 후 8188/8190 포트와 `python.exe` 잔여 프로세스 확인.
5. `Pankeki.cmd`로 서버를 먼저 띄운 뒤 `npm start` → 외부 서버 재사용(ownership `external`) 확인. 앱을 닫아도 그 서버는 계속 살아 있어야 한다.
6. 패키지: `package-win.cjs`로 만든 `Pankeki.exe` 실행 → 폴더 선택 창 → 프로젝트 선택 → 2번과 같은 확인.

## 4. 보고 형식

단계마다 `통과 / 실패 / 미실행`과 증거 파일 경로를 적는다. 측정하지 않은 값은 null로 둔다. 단위 테스트 통과나 exe 생성만으로 실사용 통과라고 적지 않는다.
