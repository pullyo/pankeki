# Pankeki

**AI와 대화하며 캐릭터 이미지 생성·부분 편집·프로젝트 관리·2D 모션 작업을 이어가는 macOS 제작 스튜디오입니다.** Codex·Claude와 로컬 ComfyUI를 연결하며 Blender 기반 영상 제작을 실험합니다.

대화와 요청 해석·도구 연결은 본인 계정으로 로그인한 Codex CLI 또는 Claude Code CLI를 사용합니다. 이미지 생성과 인페인팅은 로컬 ComfyUI에서, 단순 색상 변경은 CPU에서 처리합니다. **프롬프트와 이미지 문맥이 선택한 외부 AI 서비스로 전송될 수 있으므로 완전 오프라인 앱은 아닙니다.**

현재 macOS 개발판은 [mac-release-20261028 브랜치](https://github.com/pullyo/pankeki/tree/mac-release-20261028)에 있습니다. 저장소 기본 브랜치는 `main`이므로, 새로 받을 때는 [영문 설치 안내](README.md#install)의 `git clone --branch mac-release-20261028` 명령을 사용하세요. Mac 실행 안내는 [README.macos.ko.md](README.macos.ko.md), 영문 소개는 [README.md](README.md)를 참고하세요.

Comfy.org Open Source Higgsfield 대회를 준비하며 개발하고 있으며 기본 UI 언어는 한국어입니다.

## 현재 할 수 있는 일

| 작업 | 현재 기능 |
| --- | --- |
| AI와 대화 | 하나의 자동 composer에서 대화·생성·편집 요청을 입력합니다. 실제 AI/이미지 모델과 해상도를 확인하고, 진행·취소·오류 안내, 답변 복사와 실패한 요청의 수동 다시 입력을 사용합니다. |
| 이미지 생성 | Apple Silicon의 로컬 ComfyUI를 통해 SDXL 1.0 Base와 Animagine XL 4.0 Opt로 후보를 만듭니다. |
| 이미지 작업공간 | 이미지를 클릭하면 오른쪽 편집기가 열립니다. 이미지 위의 편집·저장 액션을 유지하며 작업할 수 있습니다. |
| 부분 편집 | 브러시나 업로드한 마스크로 수정 영역을 정합니다. 재생성에는 SDXL Inpainting 0.1을, 단순 색상 변경에는 CPU 도구를 사용합니다. 최종 합성에서 마스크 밖 RGB와 원본 alpha를 보존합니다. |
| 일반 생성과 프로젝트 | 일반 이미지 생성 기록은 프로젝트를 등록하지 않고 보관합니다. **새 프로젝트** 또는 **프로젝트로 저장**을 명시적으로 선택해 목록에 등록하고, 전용 프로젝트 화면에서 여러 작업을 찾아 저장·열기·내보내기를 이어갑니다. 파일 저장만으로 일반 생성이 프로젝트가 되지는 않습니다. |
| 자체 2D 모션 | 부위·메시·리그·표정·동작을 편집하고 PNG와 48프레임 ZIP으로 출력합니다. |
| Blender 영상 실험 | 선택한 Blender scene의 가이드를 렌더링하고 로컬 영상 runtime으로 연결합니다. 자체 2D 모션 편집기와는 별도 흐름입니다. |

## AI 연결과 저장

데스크톱 앱은 같은 웹 UI와 로컬 Pankeki 서버를 사용하며, Codex·Claude CLI가 대화와 도구 요청을 연결합니다. 로컬 이미지 처리와 외부 AI 서비스의 대화 처리를 구분해 사용하세요. 같은 생성·편집 API를 MCP 도구로 연결하는 선택적 플러그인도 있습니다.

후보·편집 상태는 앱의 IndexedDB와 다시 열 수 있는 프로젝트 파일로 보관합니다. 이미지 PNG·보드 PNG와 프로젝트 파일을 내보낼 수 있습니다.

## 현재 한계

- **Live2D/Cubism의 `.moc3` 재생은 지원하지 않습니다.** 폴더의 경로·참조·해시 검사는 가능하지만 공식 Core/Framework SDK가 없어 실제 재생은 비활성입니다.
- **Blender/로컬 영상은 실험 흐름입니다.** 호환되는 로컬 도구와 영상 모델은 별도로 필요하며, 일반적인 영상 품질·캐릭터 일관성·긴 춤 동작·처리 속도를 보장하지 않습니다.
- 마스크 재생성은 요청한 색상이나 형태를 충분히 반영하지 못할 수 있습니다. 단순 색상 변경에는 색상 변경 도구를 사용하고 결과는 직접 비교하세요.
- 한 대의 Apple Silicon Mac에서 로컬 검증한 범위입니다. 넓은 하드웨어 호환성을 확인한 것은 아니며, Windows/CUDA 경로는 아래 과거 개발 기록으로 남깁니다.
- CPU·가짜 ComfyUI 응답을 사용하는 테스트 통과와 실제 GPU 추론·원화 품질·앱 화면 수용은 별도로 확인합니다.

## 설치·라이선스

현재 설치 명령과 요구 사항은 [README.md](README.md#requirements)와 [Mac 실행 안내](README.macos.ko.md)를 따르세요. 코드의 [MIT 라이선스](LICENSE)와 모델·ComfyUI·폰트·아이콘의 개별 라이선스는 구분되며, [THIRD_PARTY.md](THIRD_PARTY.md)를 확인하세요.

## 표정과 동작: 자체 제작 / Live2D 재생

기존 `자체 제작`은 준비한 PNG·메시·리그로 동작을 편집하고 PNG/48프레임을 출력합니다. 같은 화면의 `Live2D 재생`은 별도 작업 방식입니다. `.model3.json`과 참조된 `.moc3`·텍스처·동작·표정 파일을 포함한 모델 폴더를 선택하세요. 여러 manifest가 있으면 열 모델을 직접 고릅니다. 폴더 선택을 지원하지 않는 브라우저에서는 전체 파일 선택을 쓸 수 있지만, 하위 폴더의 상대경로가 사라지면 열 수 없습니다. `.moc3` 하나만으로는 열 수 없습니다.

현재 공식 Core/Framework 실행기와 사용범위 확인은 준비 전입니다. 모델 묶음의 경로·참조·파일 해시 검사는 사용할 수 있지만, 이 성공이 MOC 검사·PNG 디코드·실재생 성공을 뜻하지 않습니다. 재생/복원/효과 조절은 준비 전에는 비활성입니다. SDK를 자동으로 받거나 Editor에서 추출하지 않습니다. `자체 제작으로 돌아가기`로 기존 작업을 계속할 수 있습니다.

실제 실행기가 준비된 뒤에는 모델 정의의 범위와 제공 동작·표정·물리·포즈만 조절합니다. 음성 재생·실시간 립싱크·cmo3 편집·moc3 출력·기존 PNG 출력기의 Live2D 모델 출력은 지원하지 않습니다. 모델 파일은 서버에 업로드하지 않습니다.

Live2D 세션은 원본 파일을 포함하지 않는 참조 기록이며 `pankeki-cubism-studio-v1`의 `sessions/current`에 별도 저장합니다. 실제 runtime snapshot이 없으면 세션을 만들지 않습니다. 기존 이미지/움직임 저장소는 그대로 유지합니다. 같은 모드의 상단 프로젝트 저장은 Live2D 세션 파일로 분기합니다. 다시 열 때 원래 모델 폴더를 재선택하고 모든 해시와 SDK 출처를 대조하며, 동작·물리는 처음부터 재시작합니다. 파일이 달라지면 이전 정상 화면을 유지하고 복원을 거절합니다.

### 정밀 리깅 작업

`표정과 동작`에서 **정밀 리깅으로 복사**를 누르면 현재 기본 제작의 준비된 메시를 별도 작업으로 복사합니다. 원래 v2 프로젝트와 원화는 유지됩니다. 저장한 파일은 **리깅 작업 열기**로 다시 엽니다. 정밀 리깅은 브라우저의 `pankeki-authoring-v3` 저장소를 사용하며 기존 제작과 Live2D 세션 저장소를 바꾸지 않습니다.

파라미터 정의/값, 부위의 한 축 또는 두 축 조합 키, 가림 연결, 변형 격자와 부위별 연결을 실제 입력란에서 편집할 수 있습니다. 기본값의 기준 형태는 잠겨 있고 마지막 확장 연결 삭제 시 원래 기본 연결이 다시 적용됩니다. 부모 부위가 변형 격자에 연결돼 있어도 자식과 숨은 가림 원본은 각각 연결해야 합니다. 숫자 입력은 Enter/포커스 이동으로 확정하고 Esc로 되돌립니다. 저장·자동저장·PNG·ZIP은 유효한 미확정 입력을 먼저 적용하며 잘못된 입력은 오류를 표시하고 차단합니다.

새 동작은 2초·24fps이며 정의된 모든 파라미터를 보존합니다. PNG와 48프레임 ZIP은 미리보기와 같은 자체 렌더러를 사용합니다. 형상·정의·가림·격자 변경으로 오래된 표정/동작은 다시 작성해야 하며 이전 hash를 자동 승인하지 않습니다. 기본 제작의 기존 동작이 정밀 리깅 동작으로 자동 변환되지는 않습니다. 숫자/CPU 출력 검증은 실제 브라우저 화면·GPU 성능·원화 품질 승인과 별개입니다. 공식 Cubism SDK 없는 상태에서 실제 `.moc3` 재생 완료를 뜻하지 않습니다.

## 과거 Windows 개발 기록

<details>
<summary>2026-10-19~20 Windows 실행·설치·검증 기록 펼치기</summary>

아래 PowerShell·`D:\Pankeki` 절차와 캐시·서버 정책 설명은 당시 개발 기록입니다. 현재 macOS 설치·실행 지침으로 사용하지 마세요. 명령과 실험 기록은 보존합니다.

## 실행

PowerShell에서:

```powershell
Set-Location D:\Pankeki
# 이미 이 작업에서 설치한 환경은 그대로 재사용합니다.
# 이미 이 작업의 ComfyUI가 실행 중인 경우:
.\scripts\setup-comfy.ps1 -Inspect
# 서버가 꺼져 있으면 대신: .\scripts\setup-comfy.ps1 -Start -EnableCropAndStitch
$comfyServer = Get-Content .\evidence\environment-comfy-process.json -Raw | ConvertFrom-Json
.\.venv\Scripts\python.exe .\scripts\prepare_manifest.py --pid $comfyServer.listener_pid
.\scripts\start-pankeki.ps1
```

브라우저에서 <http://127.0.0.1:8190>을 엽니다. ComfyUI 자체 화면은 <http://127.0.0.1:8188>입니다. 8188이 이미 사용 중이면 시작 스크립트는 기존 프로세스를 보존하고 중단합니다. 이 작업이 시작해 둔 서버가 있으면 다시 시작할 필요가 없습니다.

최종 실행 중인 앱은 검증된 `windows_read_lock` 정책을 사용합니다. 위 manifest 명령을 다시 실행하면 기본 `strict` 정책으로 돌아가므로, 같은 설정을 유지하려면 `--fingerprint-policy windows_read_lock`을 붙이세요.

`prepare_manifest.py`는 관리 중인 서버의 PID/생성 시각/시작 옵션/소스와 모델 내용 hash를 묶습니다. 서버 재시작·코드 변경·모델 변경 후에는 새 manifest와 앱 재시작이 필요합니다. 알 수 없는 기존 서버에는 manifest 없이 연결할 수 있으나 정확한 앱 캐시는 우회합니다.

## 새 설치 또는 복구

```powershell
Set-Location D:\Pankeki
.\scripts\setup-app.ps1
.\scripts\setup-comfy.ps1 -InstallDependencies -DownloadModel
```

Python 실행 파일을 찾지 못하면 `-Python '실제 Python 3.12 실행 파일 경로'`를 지정합니다. WindowsApps의 실행되지 않는 `python` 별칭에 의존하지 않습니다. 의존성·모델은 프로젝트 안에 설치됩니다. CUDA torch와 모델 다운로드는 수 GB입니다. 설치 버전은 `requirements-lock.txt`와 `evidence/environment-pip-freeze.txt`, ComfyUI commit과 모델 hash는 환경 문서를 확인하세요.

## 사용

1. **새 이미지 생성**에서 prompt, seed, steps와 크기를 지정합니다. 기본 SD Turbo 실험값은 512×512, 1 step, CFG 1, Euler/normal입니다. 여러 step의 다른 schedule은 별도 품질 실험이며 기본값과 혼합 비교하지 않습니다.
2. **이 결과 부분 수정** 또는 원본 파일 업로드 후 흰색 브러시로 수정할 곳을 칠합니다. 검정 마스크는 보존합니다. 같은 크기의 흑백 PNG 마스크도 업로드할 수 있습니다.
3. ROI 체크를 끄면 전체 크기 inpaint, 켜면 문맥 여백을 포함한 실제 crop입니다. 처리 면적이 전체의 75% 이상이면 전체 경로로 돌아갑니다. 빈 마스크는 서버를 호출하지 않습니다.
4. 결과의 PNG 저장 링크로 저장합니다. 원본 파일은 덮어쓰지 않습니다. PNG의 마스크 밖 RGB 픽셀과 원본 alpha 채널을 보존합니다. JPEG는 디코딩·EXIF 방향 보정 후 픽셀을 기준으로 합니다.
5. 새로운 요청은 같은 브라우저 세션의 이전 결과 표시를 취소합니다. 전역 ComfyUI interrupt는 호출하지 않으므로 실행 중 GPU 작업이 계속될 수 있습니다.

미리보기는 최종 이미지와 구분하고 최대 초당 5회만 앱 표시 버퍼에 반영합니다. ComfyUI의 preview 생성 자체를 줄이는 기능은 아닙니다. 요청 성공 후 기존 최종 이미지를 새 결과로 바꾸며 실패 시 이전 결과가 유지됩니다.

## 저장 위치

- `runtime/runs/<job_id>/`: 원본, 마스크, 실제 workflow, 의존성, recipe, 결과 PNG와 metrics.
- `runtime/metrics.jsonl`: 실제 앱 실행 기록. 실패·취소도 별도로 기록합니다.
- `runtime/cache/`: 256MiB 논리 용량 제한 SQLite 완료 결과 캐시. UI에서 비울 수 있습니다. SQLite 파일 자체의 여유 page는 재사용하며 디스크 파일 크기와 논리 제한은 다릅니다.
- `evidence/`: 테스트, 실제 GPU 실험, CPU 계획 실험의 원자료.
- `integrations/github/validation/`: 외부 노드 import/등록/CPU/GPU 비교와 예제 API workflow.

## 검증·재실험

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m unittest discover -s integrations\github -p test_workflow_bridge.py -v
.\.venv\Scripts\python.exe scripts\benchmark_gpu.py
.\.venv\Scripts\python.exe scripts\benchmark_cache_policy.py
.\.venv\Scripts\python.exe scripts\verify_live_app.py
.\.venv\Scripts\python.exe scripts\benchmark_planning.py --help
.\.venv-comfy\Scripts\python.exe scripts\benchmark_external.py --help
```

GPU benchmark는 실제 서버가 필요하며 cache miss/hit, 새 seed, 미리보기, 1/5/10/25/50/100% 마스크의 full/ROI 경로를 기록합니다. 이미 수행된 실험 결과는 `docs/results.ko.md`를 보세요. `unittest`의 가짜 Comfy 응답은 GPU 검증이 아닙니다.

Node가 설치되어 있으면 `node --test scripts/test_ui_state.cjs`로 실제 inline JS의 업로드·revision 경쟁 회귀를 실행할 수 있습니다. 이 검사는 브라우저 렌더링 검사가 아닙니다.

## 선택 기능과 한계

- 완료 캐시는 내용 hash와 전체 workflow/recipe를 확인합니다. 매 요청 모델 전체 hash 확인 비용도 시간에 포함합니다. ComfyUI의 자체 RAM 노드 캐시와 앱 cache hit를 구분합니다. 재사용은 새로운 이미지 추론 가속이 아닙니다.
- 선택적으로 manifest 생성 시 `--fingerprint-policy windows_read_lock`을 붙일 수 있습니다. 앱 시작 때 모델을 한 번 해시하고 Windows 읽기 잠금을 유지합니다. 앱 종료 전까지 모델 수정·교체와 상위 폴더 이름 변경이 제한되며, 일반 읽기는 가능합니다. 잠금을 얻지 못하면 매 요청 전체 해시로 돌아갑니다. 모델 변경 때는 앱을 종료한 뒤 ComfyUI와 manifest도 갱신하세요. 기본 정책은 `strict`입니다.
- ROI는 전체 입력과 모델 문맥이 달라집니다. 작은 crop에서 품질이 나빠질 수 있어 기본 비활성입니다. 얼굴·손·글자·LoRA 전반의 품질 승인을 받은 기능으로 표시하지 않습니다.
- CropAndStitch는 고정 소스의 별도 예제 workflow와 비교 스크립트로 연결합니다. 앱 자체 ROI를 교체하지 않습니다. 작은 crop의 모델 규격 검사 및 fallback은 실행 스크립트에서 수행합니다.
- 타일·쿼드트리·LOD는 제한된 계획 실험만 구현했습니다. 실제 타일 denoising/전역 품질 검증 전에는 실행하지 않습니다.
- WaveSpeed FBCache는 기본 비활성입니다. 현재 모델에서 skip·누적 오차·품질 검증 없이 켜지 않습니다. TeaCache·torch.compile·별도 GPU 커널·스칼라 행렬곱 변환은 채택하지 않았습니다.
- 로그의 노드 시간은 WebSocket 도착 wall time입니다. CUDA event 단계별 시간, inference peak allocated/reserved VRAM, 브라우저 최종 paint 시간은 측정하지 않았으면 null입니다.

## 출처와 라이선스

환경은 `docs/environment.ko.md`, 개별 코드·모델 라이선스는 `docs/licenses.ko.md`와 원본 LICENSE 파일에 보존했습니다. 모델은 로컬 평가 목적으로 사용했습니다. 모델 라이선스는 소프트웨어 라이선스와 다릅니다.

Powered by Stability AI. ComfyUI, CropAndStitch, WaveSpeed의 기존 기술을 사용하며 독자 발명이나 특허성·대회 적합성을 주장하지 않습니다.

</details>
