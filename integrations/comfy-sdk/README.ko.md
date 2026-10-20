# 공식 Comfy SDK 로컬 브리지

`comfy-sdk 0.5.0` → `comfy-api-proxy 0.1.6` (`127.0.0.1:8189`) → 기존 ComfyUI (`127.0.0.1:8188`). 별도 계정·API 키·클라우드 호출 없이 공식 SDK로 워크플로 제출, 진행/미리보기 수신, PNG 다운로드를 실행한다. Python 앱은 이 폴더의 격리 Python을 subprocess로 호출한다. 기존 앱/ComfyUI 가상환경은 수정하지 않는다.

## 설치 및 시작

Python 3.10 이상과 실행 중인 ComfyUI가 필요하다. 아래 명령은 프로젝트 루트에서 PowerShell로 실행한다.

```powershell
python -m venv integrations/comfy-sdk/.venv
& ./integrations/comfy-sdk/.venv/Scripts/python.exe -m pip install -r integrations/comfy-sdk/requirements.lock.txt
powershell -NoProfile -ExecutionPolicy Bypass -File integrations/comfy-sdk/start-proxy.ps1
```

프록시는 숨김 창으로 loopback에만 시작한다. 포트가 이미 사용 중이면 기존 프로세스를 건드리지 않고 실패한다. `runtime/proxy-process.json`에 실행기/실제 리스너 PID, 시작 시각, 로그 경로가 기록된다. 프록시 상태는 `http://127.0.0.1:8189/api/v2/health`에서 확인한다. `runtime/state/`에 프록시 작업/중복 제출 키를 저장한다. 모델 업로드 옵션은 활성화하지 않는다.

## 실제 생성 예제

ComfyUI에 `sd_turbo.safetensors`가 이미 있어야 한다. 예제는 512×512, 1 step, Euler/normal, CFG 1, seed 424201이다.

```powershell
& ./integrations/comfy-sdk/.venv/Scripts/python.exe -X utf8 integrations/comfy-sdk/bridge.py --request integrations/comfy-sdk/example-request.json --output-dir integrations/comfy-sdk/outputs/example-new --receipt integrations/comfy-sdk/outputs/example-new/receipt.json
```

실행마다 새로운 결과 폴더/receipt 경로를 사용한다. 이미 있는 receipt는 재제출을 막기 위해 거부한다. 통신 오류 후에는 기록된 `job_id`와 ComfyUI 기록을 먼저 확인한다. 제출 응답이 유실되어 `job_id`가 없더라도 서버가 접수했을 수 있으므로 자동 재시도하지 않는다.

## 앱 연결 계약

request JSON:

```json
{
  "workflow": {"노드ID": {"class_type": "노드종류", "inputs": {}}},
  "assets": [{"node_id": "4", "input_name": "image", "path": "input.png"}],
  "output_nodes": ["7"],
  "timeout_seconds": 600,
  "idempotency_key": "호출자가 저장한 고유한 ASCII 키"
}
```

`workflow`는 Comfy API 형식이다. `assets`, `output_nodes`, `timeout_seconds`, `idempotency_key`는 선택사항이다. asset 경로는 request 파일 기준 또는 절대 경로이며 기존 노드/입력에 SDK `assets.from_file()` 핸들을 삽입한다. 업로드 자체와 `core/ASSET` 치환은 공식 SDK가 수행한다. 기존 `upload_png()`의 파일명 반환 방식과 다르므로 호출 앱은 PNG를 임시 저장한 뒤 해당 LoadImage 노드를 assets에 매핑한다. URL/클라우드 주소 입력은 받지 않는다.

표준 출력은 UTF-8 NDJSON이다. `submitted`의 `job_id`를 즉시 보존한다. `progress`, `status`, `preview`(JPEG/PNG bytes의 `data_base64`), `output`, `complete` 이벤트가 이어진다. `complete.receipt.state == "succeeded"`와 프로세스 exit 0을 완료 기준으로 사용한다. 실패는 `error` 이벤트와 exit 2이며 receipt에 상태/오류/제출 키/알려진 job ID를 보존한다. 프록시 0.1.6의 실제 검증에서 SDK job ID와 native ComfyUI prompt ID가 동일했다.

선택 `--cancel-file PATH`에 지정한 파일이 생기면 로컬 관찰/결과 사용을 취소한다. 기존 앱 계약에 맞춰 전역 interrupt는 전송하지 않으므로 이미 제출된 GPU 작업은 끝날 수 있다. 관찰 시간 초과도 서버 중단을 의미하지 않는다. SDK는 별도 subprocess에서만 사용하도록 설계되었으며 이 프로세스 안에서 Comfy 관련 환경 변수와 NO_PROXY를 로컬 전용으로 설정한다.

## 검증 기록

2026-10-19 실제 기존 RTX 5060 환경에서 `outputs/smoke/receipt.json`의 작업 `754ce872-2ceb-45f7-a70a-9e92f7bf796a`가 성공했다. PNG 512×512 / 418,323 bytes / SHA256 `f5032c7b74e540f1d5c7877a2b933948c37a6b1628da70ed5b182c87b33943a9`를 SDK로 다운로드했다. `executed-workflow.json`, `native-history.json`, `runtime/smoke-events.jsonl`에 워크플로·서버 기록·진행/미리보기 증거가 있다. 미리보기 1개를 수신했으며 native history의 캐시 노드는 1, 3이었다. sampler 5는 새로 실행됐다.

SDK 제출/다운로드/추적 전체 0.710초, native service 0.479초는 이미 모델이 준비된 상태의 단일 확인값이다. 성능 비교나 캐릭터 품질 검증 결과가 아니다. 실제 PNG는 파란 망토를 입은 여우 캐릭터이며 요청한 가방/손 디테일은 정확하지 않다. 앱의 SDK 경로 연결은 별도 앱 어댑터에서 검증해야 한다.

설치된 공식 proxy `comfy_api_proxy/app.py`의 708–751행은 UUID job ID를 native `/prompt`의 `prompt_id`와 `client_id`로 그대로 전달한다. 326행에서 동일 ID로 native history를 조회하고 481행에서 v2 job ID로 반환한다. 반면 `outputs_reused`는 캐시된 노드가 하나라도 있으면 참이다(307–320행). 이를 denoiser 생략/재실행의 근거로 사용하면 안 된다. 앱 어댑터는 `native /history/{job_id}`의 `execution_cached` 노드 목록과 sampler 노드 ID를 대조해야 한다. 소스 해시는 `source-hashes.json`에 기록했다.

```powershell
& ./integrations/comfy-sdk/.venv/Scripts/python.exe -X utf8 -m unittest discover -s integrations/comfy-sdk -p test_bridge.py -v
& ./integrations/comfy-sdk/.venv/Scripts/python.exe -m pip check
```

## 출처와 라이선스

- [공식 SDK 문서](https://docs.comfy.org/development/api-development/sdks), [공식 self-hosted 프록시 문서](https://docs.comfy.org/development/comfyui-server/api-proxy).
- [Comfy-Org Python SDK](https://github.com/Comfy-Org/comfy-python-sdk), [Comfy-Org API proxy](https://github.com/Comfy-Org/comfy-api-proxy): 모두 MIT. 배포 wheel의 원문 라이선스는 `licenses/`에 보관했다.
- `provenance.json`에 설치한 버전/공식 저장소/PyPI wheel URL/SHA256, `install-report.json`에 pip 설치 원본 보고서, `requirements.lock.txt`에 전체 의존성 버전을 보관했다.
- SDK wheel SHA256: `dfcd3ab026cfc42e83681148766fe8b3d619fdc476ec995e793c1efcab2fd1c5`; proxy wheel SHA256: `1ea405f1a4dc5886d06d630bc1de57fd8754062776ace797e66969636ca941c6`.
- 모델 라이선스는 기존 `docs/licenses.ko.md`를 따른다. Pankeki 자체 코드의 출품용 OSS 라이선스 지정은 프로젝트 총괄에서 완료해야 한다(이 문서 작성 시 루트 LICENSE 파일 없음).

공식 SDK 문서는 현재 배포 CLI보다 단순한 예를 보여준다. 설치된 proxy 0.1.6의 실행 명령은 `python -X utf8 -m comfy_api_proxy.cli run ...`이다. `-X utf8`은 한국어 Windows 기본 인코딩에서 CLI 도움말 문자의 인코딩 오류를 방지한다.
