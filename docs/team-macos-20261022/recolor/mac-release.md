# CPU 정밀 색 변경: Mac 실행·재시작 인계

작성일: 2026-10-23 KST · 담당: Pankeki Mac 출시 엔지니어
프로젝트: `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki` (이하 상대 경로는 이 루트 기준).
범위: 현재 실행 상태·소스·설정의 읽기 전용 확인과 총괄용 절차. **아래 종료·시작 명령은 이 채팅에서 실행하지 않았다.**

## 핵심 판정과 확인한 프로세스 관계

**현재 런처에서 앱 PID만 종료하면 공유 ComfyUI도 간접 종료된다. 현재 구성의 기본 인계는 전체 런처의 정상 종료·재시작이다.** 원래 요청의 Pankeki 단독 재시작은 현재의 결합된 부모·자식 관리 아래에서는 정상 절차로 제공되지 않는다.

`runtime/macos/processes.json`과 실제 `ps`, `lsof`의 PID·부모·명령·cwd·LISTEN을 대조했다. ps는 샌드박스 제한 후 승인된 읽기 전용 조회로 확인했다. API·브라우저·GPU·서버 명령을 호출하지 않았다.

| 역할 | 확인한 PID / PPID | 시작 시각(ps 원문)·상태 | 실제 실행·작업 폴더 |
|---|---|---|---|
| 런처 | 10937 / 9878 | Thu Oct 22 21:05:51 2026 · Ss | `.venv-macos/bin/python scripts/run_macos.py --no-browser`, 프로젝트 루트 |
| ComfyUI | 10940 / **10937** | Thu Oct 22 21:05:51 2026 · S | `.venv-macos/bin/python -u main.py ...`, `vendor/ComfyUI`; `127.0.0.1:8188` LISTEN |
| Pankeki | 10989 / **10937** | Thu Oct 22 21:05:56 2026 · S | `.venv-macos/bin/python -u -m pankeki serve --port 8190 --comfy-url http://127.0.0.1:8188 --config <root>/runtime/macos/config.json`; `127.0.0.1:8190` LISTEN |

이는 관측 시점의 값이므로 실행 전 반드시 재조회한다. `scripts/run_macos.py:113`의 실제 루프는 `while app.poll() is None`이다. 앱 자식이 끝나면 루프를 빠져나가고 `finally`의 122–129행에서 역순으로 **앱과 ComfyUI 모두**를 terminate하며, 필요하면 15초 대기 후 kill한다. 앱의 정상·오류 종료 모두 finally를 통과한다. 따라서 앱 자식 PID만 종료하거나 현재 런처에 겹쳐 새 Pankeki를 시작하는 절차는 채택하지 않는다.

## Source guard와 config 처리

- `pankeki/engine.py`의 `Engine.__init__`는 시작 시 `source_fingerprint(pankeki/)`를 `self.adapter_sources`로 메모리에 보관하고 `Engine.__call__`은 요청 실행 시 현재 소스와 비교한다. 최초 스냅샷은 135/222행, CPU 분기 추가 후 확인은 145/236행이다. backend 변경 후 이전 프로세스를 계속 쓰면 `Pankeki source changed while running. Restart Pankeki before generating.`의 대상이 된다.
- `source_fingerprint`는 `pankeki/environment.py:9` 구현을 사용한다. `pankeki/` 안의 `.py/.pyi/.json/.txt/.gz/.model/.tiktoken/.yaml/.yml/.pyd`를 상대 경로와 내용으로 해시하고 `__pycache__` 등을 제외한다. 새 CPU 모듈 추가도 대상이다. 이번 문서·`runtime/macos/recolor-quality/mac/`·`web/`는 이 앱 지문의 범위 밖이다.
- 최초 디스크 기준값은 `01da77e7286de7289e819e5b5847fd2436e776a4e632352b1c9e621c8ab5cd52`다. 병행 backend 편집 후 2026-10-23 09:56:57 KST의 후속 확인값은 `731aabdebe48f44a3a2bbe371a2eab0151d3cd3be2a3837f718abeeffe0500b8`이다. **둘 다 총괄의 최종 통합 지문은 아니며 실행 중인 프로세스의 보관 값도 읽지 않았다.** 최종 backend 확정 후 다시 계산하고 그 소스를 새 프로세스에 읽힌다.
- 현재 Mac config는 `transport=direct`, `managed_builtin_only=false`, `fingerprint_policy=strict`, `runtime_guard` 없음이다. 모델 정의는 기존 SDXL Base/SD Turbo 그대로다. 현재 unmanaged 경로는 `_dependencies`에서 exact cache를 일찍 우회한다. 이와 별도로 앱 소스 guard는 유효하다.
- 앱 소스 지문을 넣는 Mac config 키는 없다. CPU backend 변경만으로 기존 모델 manifest나 config를 수동 변경할 필요는 없다. 일반 런처는 시작할 때 `runtime/macos/config.json`과 `model-paths.yaml`을 현재 루트에서 재생성하므로, 재시작 후 의도한 키·경로가 유지됐는지 확인한다.
- `scripts/prepare_manifest.py`는 Windows 소유 프로세스·CUDA·`.venv-comfy/Scripts/python.exe`를 전제로 별도 `runtime/config.json`을 쓴다. Mac source guard 갱신에 사용하지 않는다. guard 비교 삭제나 실행 중 `adapter_sources` 교체로 우회하지 않는다.

## CPU·모델 미사용·오프라인 조건

두 venv에서 설치 메타데이터를 읽어 **NumPy 2.3.5 / Pillow 12.3.0**을 확인했다. 새 모델·추가 패키지 다운로드나 venv 변경은 필요하지 않다.

최초 스냅샷 이후 병행 편집으로 `pankeki/recolor.py`와 CPU 요청 분기가 추가됐다. 후속 정적 확인에서 **`mode=inpaint`와 `edit_operation=recolor`**가 계약이다. `Engine.validate_request:168`은 모델 선택/availability 검사 전에 이 요청을 별도 검증하고 반환한다. `__call__:233-240`은 해당 요청의 model_id를 None·selected_model을 빈 dict로 두고 transport fingerprint 호출을 건너뛴다. 254–259행은 CPU 처리·저장 뒤 반환해 뒤쪽 `_dependencies`·업로드·Comfy 실행에 도달하지 않는다. source guard는 236행에 유지된다. `model_calls=0`, `denoiser_executed=false`, `kind=local_recolor`도 이 분기에서 설정한다. 이는 **소스의 모델 독립 구조 확인이며 실행 결과가 아니다.**

앱 시작 자체는 `ComfyClient` 생성 시 네트워크 통신을 하지 않고 처음부터 무거운 모델을 읽을 필요도 없다. 기존 `--editor-only`는 Comfy를 시작하지 않고 앱만 시작하는 구현이며 CPU 요청의 모델 독립성은 새 backend 분기가 담당한다. 기존 UI의 모델 준비 guard도 별도 통합 지점이므로 backend CPU 구조와 전체 UI 수용을 구분한다. 이번에는 UI/API 실동작을 확인하지 않았다.

CPU 색 변경의 오프라인 수용에는 backend 통합 후 ①Comfy 미실행·모델 비선택 상태에서도 CPU 요청 수용, ②Comfy HTTP/GPU/모델 읽기 0, ③CPU 처리·저장·후보 성공의 별도 근거가 필요하다. 이번에는 API 요청을 보내지 않았다. 현재 `/api/health`는 Comfy의 `/system_stats`를 조회하므로 그 `comfy=false`만으로 CPU 기능의 가능 여부를 판단하지 않는다.

## 총괄이 실행할 기본 절차: 현재 전체 런처 정상 재시작

1. backend·필요한 UI 통합과 관련 검증을 마치고 최종 소스를 확정한다. 저장·생성·비교 처리 중이 아닌 시점을 총괄이 선택한다. 공유 Comfy도 멈추는 범위이므로 다른 담당의 GPU 작업이 끝났는지 확인한다.
2. 현재 메타데이터에서 PID를 다시 읽고 실제 PID·PPID·cwd·argv·양쪽 LISTEN을 대조한다. 아래 기록 값만 믿고 신호를 보내지 않는다. 소유 관계나 포트 사용자가 다르면 중단하고 현재 상태를 확인한다.

```bash
cd '/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki'
read -r recolor_launcher_pid recolor_comfy_pid recolor_app_pid < <(
  .venv-macos/bin/python - <<'PY'
import json
from pathlib import Path
p = json.loads(Path('runtime/macos/processes.json').read_text())
assert p['mode'] == 'generation' and len(p['children']) == 2
assert all(type(n) is int and n > 1 for n in [p['launcher_pid'], *p['children']])
print(p['launcher_pid'], *p['children'])
PY
)
ps -p "$recolor_launcher_pid,$recolor_comfy_pid,$recolor_app_pid" -o pid=,ppid=,lstart=,stat=,command=
lsof -a -p "$recolor_launcher_pid,$recolor_comfy_pid,$recolor_app_pid" -d cwd -Fn
lsof -nP -iTCP:8190 -sTCP:LISTEN
lsof -nP -iTCP:8188 -sTCP:LISTEN
```

3. 같은 터미널에서 위 정보가 이 프로젝트의 현재 런처와 두 자식 서버임을 확인한 경우에만 **런처 PID에** SIGTERM을 보낸다. 런처의 SIGTERM 핸들러가 KeyboardInterrupt를 발생시키고 기존 finally가 두 자식을 종료한다. 자식 PID 개별 종료·프로세스명 일괄 종료·포트 사용자 무조건 kill은 하지 않는다.

```bash
kill -TERM "$recolor_launcher_pid"
for ((recolor_wait = 0; recolor_wait < 40; recolor_wait += 1)); do
  if ! lsof -nP -iTCP:8190 -sTCP:LISTEN >/dev/null 2>&1 &&
     ! lsof -nP -iTCP:8188 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
ps -p "$recolor_launcher_pid,$recolor_comfy_pid,$recolor_app_pid" -o pid=,ppid=,stat=,command=
lsof -nP -iTCP:8190 -sTCP:LISTEN
lsof -nP -iTCP:8188 -sTCP:LISTEN
```

40초는 확인 대기의 상한이다. **기존 부모·자식이 종료되고 두 포트가 비었음을 확인한 경우에만 다음으로 진행한다.** 종료 실패 시 다른 프로세스를 종료하거나 새 런처를 겹쳐 실행하지 않는다.

4. 최종 source fingerprint와 config 해시를 기록한다. 아래 파일은 절차 실행 시 총괄이 만드는 산출물이며 이 문서 작성 시에는 만들지 않았다.

```bash
env PYTHONDONTWRITEBYTECODE=1 .venv-macos/bin/python - <<'PY'
import hashlib, json
from datetime import datetime, timezone
from pathlib import Path
from pankeki.environment import source_fingerprint
root = Path.cwd()
record = {
    'checked_at_utc': datetime.now(timezone.utc).isoformat(),
    'source_fingerprint': source_fingerprint(root / 'pankeki'),
    'config_sha256': hashlib.sha256((root / 'runtime/macos/config.json').read_bytes()).hexdigest(),
}
target = root / 'runtime/macos/recolor-quality/mac/final-source-fingerprint.json'
target.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
PY
```

5. 총괄이 관리하는 전용 터미널 또는 exec 세션에서 현재와 같은 일반 모드를 시작한다. 브라우저는 자동으로 열지 않는다. 새 런처가 Comfy와 앱을 소유한다. 두 서버를 재시작하므로 Comfy의 기존 메모리 상태는 이어받지 않는다.

```bash
./Pankeki.command --no-browser
```

6. 시작 로그 `runtime/macos/app.log`·`comfy.log`, 새 `runtime/macos/processes.json`, ps·양쪽 LISTEN을 대조하고 새 PID를 다시 읽는다. source fingerprint를 다시 계산해 4의 값과 같고 config 내용이 위 Mac 설정·기존 모델/경로를 유지하는지 확인한다. 시작 후 추가 backend 편집은 다시 재시작할 대상이다. CPU 색 변경의 실동작·픽셀/저장 회귀 수용은 총괄/QA의 별도 작업이며 이번 정적 절차 확인이 이를 대신하지 않는다.

## 분리 실행으로 Comfy 재사용 및 CPU 전용 시작이 가능한 범위

**분리 실행 자체는 가능**하다. `pankeki.__main__`은 로컬 Comfy URL과 명시적 config를 받고, Mac의 direct unmanaged 설정은 같은 부모 프로세스를 요구하지 않는다. 다만 현재 런처의 Comfy를 남겨 두고 앱만 kill하는 것은 분리 운영으로의 전환이 아니다. 먼저 현재 묶음 실행을 정상 종료하고, 필요하면 총괄이 Comfy를 별도 관리 세션으로 시작하는 운영을 따로 선택한다. 그 이후 앱 쪽의 정확한 시작 형식은 다음과 같으며 기존 런처를 다시 사용하지 않는다.

```bash
env PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 \
  .venv-macos/bin/python -u -m pankeki serve --port 8190 \
  --comfy-url http://127.0.0.1:8188 --config runtime/macos/config.json
```

이 분리 운영에서는 각 세션이 자기 서버의 종료·PID 기록을 관리해야 한다. 앱 직접 시작은 기존 `processes.json`을 갱신하지 않으므로 그 파일을 새 직접 실행의 정확한 소유 기록으로 사용하지 않는다. 이번에는 이 변경을 제안·범위 정리만 했고 실행하지 않았다.

총괄이 Comfy 없는 CPU 전용 검증을 선택하면 현재 두 서버를 정상 종료한 뒤 `./Pankeki.command --editor-only --no-browser`를 사용할 수 있다. 이는 기존 SDXL 생성 서비스를 시작하지 않는 범위이며 CPU 요청 분기의 통합·수용 확인이 전제다. 새 모델 기본값이나 config의 모델 삭제는 필요하지 않다.

## 실시한 검사·보존·변경 파일

최초 Ruff는 관련 Python 8파일에 `--isolated --no-cache --no-fix --select E9,F63,F7,F82`를 실행해 0건·종료 0을 확인했다. ast-grep는 런처 감시/cleanup, config 재생성, source guard, 모델 필수 판정·Comfy 조회 위치에 11개 검색·14개 일치를 얻었다. 병행 backend 편집을 발견한 뒤 `engine.py/recolor.py`에 같은 제한 Ruff를 다시 실행해 0건·종료 0, 모델 우회·CPU dispatch·source guard 보존의 후속 ast-grep 6개 검색·7개 일치를 확인했다. 두 시점은 별도 스냅샷으로 보존했다. 재시작이나 CPU 색 변경의 동작 성공은 아니다.

최초 검사 구간에서는 런처·backend 관련 소스·config·model paths·processes.json 12파일의 SHA256이 같았다. 그 뒤 외부 담당의 `engine.py` 변경과 새 CPU 모듈 추가를 감지했고, 후속 두 파일 검사 구간에서는 다시 변하지 않았다. source guard 기준값과 검색 argv/행 번호·Ruff 결과는 `runtime/macos/recolor-quality/mac/readiness.json`, 후속 결과는 `readiness-after-backend-edit.json`, 실제 ps/lsof는 `process-snapshot.json`에 있다. config·processes.json은 최종 대조까지 그대로였다. 문서의 셸 예제 5개는 실행 없이 `bash -n` 문법 검사를 통과했다. 총괄의 최종 통합 후 필요한 경계를 재확인한다.

변경한 것은 이 `docs/team-macos-20261022/recolor/mac-release.md`와 자기 `runtime/macos/recolor-quality/mac/` 안의 읽기·정적 검사 기록뿐이다. 제품 코드·런처·설정·모델·venv·프로세스·공유 브라우저를 바꾸지 않았고 패키지/모델 추가·API 요청·GPU 실행·다른 채팅 발송·추가 채팅/하위 에이전트 생성은 하지 않았다.
