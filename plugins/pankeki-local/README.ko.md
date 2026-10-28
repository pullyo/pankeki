# Pankeki Local — Mac 로컬 MCP 플러그인

Pankeki의 기존 HTTP API/작업 큐로 SDXL 생성·마스크 부분수정·CPU 색상 변경·상태/결과/취소를 호출한다. 앱 로고·11메뉴·모델·기존 기능을 유지한다. 외부 이미지 생성기나 ComfyUI 직접 우회는 연결하지 않는다.

현재 **소스 버전은0.1.3**이다. 전용 `sdxl-inpaint-v01`은 regenerate edit에만 추가됐고 generate는 기존 Base/Turbo 두 ID를 유지한다. 실제 설치·native metadata 갱신·health·모델 파일 identity 확인은 Mac 출시 인계 단계이며, 이 소스 변경이나 mock 검사 성공으로 현재 호스트 연결/추론/원화 품질을 통과시켜서는 안 된다.

`mcp.json`과 Codex 호환 `.mcp.json`은 호스트가 절대경로를 요구하므로 체크아웃 위치에 맞춰 생성한다. 프로젝트를 옮기거나 새로 받은 뒤 `runtime/macos/pankeki-mcp-20261023/release/venv/bin/python plugins/pankeki-local/scripts/configure_paths.py`를 실행하면 두 선언이 현재 위치로 갱신되고, `--check`는 쓰지 않고 차이만 보고한다. 실행기는 전용 runtime Python으로 직접 띄운다(macOS `/usr/bin/python3`는 Xcode 라이선스 동의 전에는 실행되지 않는다). 이미 Codex에 등록한 경우(`~/.codex/config.toml`의 `mcp_servers.pankeki-local`)에는 갱신된 선언으로 다시 등록해야 반영된다.

## 실행 환경과 소유

- 서버/계약/의존성 명세: 이미지 AI 담당의 `server/pankeki_mcp.py`, `server/CONTRACT.md`, `server/requirements.txt`.
- 이번0.1.3 명시 배정의 plugin 서버·관련 tests·계약·skill·root/호환 manifest 소스: 이미지 AI 담당. 실행기·runtime/config·stage/package·설치/복원·재연결은 Mac 출시 담당이며 이번 소스 작업에서 실행하지 않는다.
- 공식 `mcp==2.3.0`과 Pillow는 이번 MCP 구현에 명시 승인된 의존성이다. 전용 환경 `runtime/macos/pankeki-mcp-20261023/release/venv`에 설치하고 기존 앱 `.venv-macos`는 변경하지 않는다.
- Cubism/추적 등 관련 없는 SDK·새 이미지 모델을 추가하지 않는다. 실행된 정확한 의존성 버전/설치 증거는 같은 release 폴더에 기록한다.
- GPU 추론과 실제 SDXL/부분수정 수용은 QA 담당이 수행한다. Mac의 stdio/status 검증은 GPU 호출이 없다.

## 도구

| 도구 | 동작 |
|---|---|
| pankeki_get_status | 기존 앱·Comfy 연결과 사용 가능한 모델 조회 |
| pankeki_generate_image | SDXL 생성 비동기 접수 |
| pankeki_edit_image | 원본·동일 크기 마스크 PNG의 regenerate 또는 CPU recolor |
| pankeki_get_job | 접수한 작업 상태 조회 |
| pankeki_get_result | succeeded PNG와 원본/마스크/요청/recipe/metrics 연결 검증 |
| pankeki_cancel_job | 논리적 취소; 진행 중 GPU 연산은 계속될 수 있음 |

색상만 바꾸고 기존 형태를 보존하려는 요청은 기존 CPU recolor를 선택한다. 형태/내용을 다시 그리거나 사용자가 SDXL을 명시하면 regenerate를 선택한다. CPU 결과를 SDXL 결과라고 부르지 않는다. 이번 SDXL 부분수정은 기술 계약을 통과했어도 파란색 지시는 따르지 못했으며, CPU 색상 변경 QA는 별도 결과로 기록한다.

먼저 status를 확인하고 반환된 job_id를 조회한다. 기본 session은 독립적이며 명시적으로 같은 session을 재사용하면 앞선 작업이 취소될 수 있다. 제출 응답 유실을 자동 재제출하지 않는다. 결과 검증 전 성공을 선언하지 않는다. 전체 입력/수치/실행 인자는 CONTRACT가 기준이며 seed는 0..2^53-1 정수다.

원본/마스크 기본 허용 루트는 앱의 output/와 runtime/다. 마스크 검정은 보존, 양수는 수정 대상이다. plugin 도구는 브라우저 부위/리그/모션 편집을 자동 노출하지 않는다. 실제 미술 품질은 도구 실행 성공과 별도다.

전용 모델은 `operation=regenerate`, `model_id=sdxl-inpaint-v01`, `cache=false`로만 요청한다. primary UNet entry의 `conditioning_model_id=sdxl-base`와 Base CLIP/VAE 공급 checkpoint entry를 제출 시 함께 동결한다. get_result는 recipe/metrics의 두 ID·이름·manifest SHA가 동결값과 같은지 확인해 `model_components`와 app-reported `component_verification`을 반환한다. 다른 구성으로 바뀐 결과나 cache hit는 거절한다. 가중치를 adapter가 새로 해시하거나 Comfy 실행 프로세스를 완전히 attestation했다는 뜻은 아니다.

빈 마스크는 `pixel_copy/model_calls=0/component_verification=not_run/workflow=null`로 유지한다. CPU 톤 보정은 `local_recolor/model_calls=0`이며 SDXL/형상 재작성 성공으로 합산하지 않는다. 기존 사람형 원본은 외부 Codex 초안이며, 전용 모델 결과도 실제 실행 후 ‘외부 초안+Pankeki 전용 SDXL 부분수정’으로 출처를 구분한다.

## 지원되는 설치 순서

아래는 앱 루트에서 실행한다. Codex 사용자 설정/설치 캐시를 직접 수정하지 않는다.

1. `python3 plugins/pankeki-local/scripts/setup_runtime.py`: 전용 환경과 승인된 서버 의존성을 준비한다. 네트워크가 필요하면 해당 설치에만 권한이 필요하다.
2. `python3 -B -m unittest discover -s plugins/pankeki-local/scripts/tests -v`: 실행기의 공백 경로/stdout·명확한 실패·복원 경계를 확인한다.
3. 전용 Python으로 `scripts/probe_stdio.py --mode legacy --output <release의 증거 경로>`를 실행한다. 실제 도구 6개 발견과 harmless status만 호출한다.
4. `python3 plugins/pankeki-local/scripts/install_local.py prepare`: bundled authoring helper로 release 아래 독립 marketplace와 검증된 소스 사본/설치 기록을 만든다. 기존 등록과 충돌하면 덮어쓰지 않는다.
5. `python3 plugins/pankeki-local/scripts/install_local.py install`: 현재 CLI가 지원하는 `codex plugin marketplace add <stage> --json`, `codex plugin add pankeki-local@pankeki-local-dev --json`만 실행한다. 사용자 홈의 등록/캐시 변경은 필요한 OS 권한으로 수행한다.

기존 앱이 정상 응답하면 그대로 사용한다. 실행기는 MCP 프로세스만 시작하며 Pankeki/Comfy를 시작·재시작·종료하거나 전체 GPU interrupt를 보내지 않는다. 앱이 꺼졌다면 정상 실행기 담당에게 인계한다. 자동 복구를 위해 기존 run_macos.py를 돌리면 config/서버가 바뀌므로 하지 않는다.

prepare 이후 소스가 바뀌면 설치하지 않는다. 설치 기록을 보존하고 새 검증/버전·소스 사본으로 갱신한다. 설치/복원은 CLI가 캐시를 관리하며 캐시 파일을 직접 편집하지 않는다. 전용 venv·모델·앱·이전 QA 결과를 플러그인 설치 패키지에 복사하지 않는다.

## 복원

`python3 plugins/pankeki-local/scripts/install_local.py restore --record <실제 install-record.json>`을 실행한다. 이 기록이 만든 pankeki-local 설치와 pankeki-local-dev marketplace만 CLI remove로 되돌린다. 부분 설치에서는 실제 완료된 단계만 해제한다. 다른 플러그인·marketplace·앱 데이터·모델·기존 증거를 되돌리거나 삭제하지 않는다. release 기록/소스 사본/전용 환경은 근거로 남긴다.

CLI 응답 유실이나 외부 변경으로 기록과 상태가 다르면 자동 반복 대신 `codex plugin list --json`, `codex plugin marketplace list --json`으로 실제 상태를 확인한다. 이번 selector/name 이외 항목은 변경하지 않는다.

## 0.1.2의 실제 Codex 연결

플러그인 참조/ID는 `pankeki-local@pankeki-local-dev`, marketplace ID는 `pankeki-local-dev`다. 선택 태그는 `[@Pankeki Local](plugin://pankeki-local@pankeki-local-dev)`다. 이 버전은 예상 AdapterError를 공식 MCP ToolError로 전달하는 P2 수정 서버를 포함한다.

현재 Codex 0.163.0-alpha.11.1의 plugin/read는 이 패키지의 설치/활성 skill을 읽었지만 `mcpServers=[]`를 반환했다. 기존 직원 채팅의 태그 명시 다음 턴에서도 실제 도구 0건이었다. 따라서 태그/설치 metadata만으로 stdio 연결을 완료했다고 보지 않는다.

추가 승인에 따라 지원되는 `codex mcp add`로 **global native 서버 `pankeki-local` 한 항목**을 등록했다. 기존 source launcher·전용 Python·같은 HTTP 큐를 재사용한다. 새 Codex app-server는 이 항목으로 실제 서버를 시작하고 도구 6개를 발견했다. 현재 실행 중 채팅의 hot reload/native 상태 호출 성공은 별도이며 미확인을 통과로 표시하지 않는다. 다음 턴 노출도 실제 발견 결과를 받아 판단한다.

native 등록을 새로 구성할 때는 전용 Python으로 `scripts/register_native.py prepare` → `add`를 사용한다. 기존 같은 이름이 있으면 덮어쓰지 않는다. 현재 이 Mac의 등록 기록은 release/native-registration.json이며 이미 등록되어 있으므로 add를 반복하지 않는다. `codex mcp get pankeki-local --json`, `codex mcp list --json`으로 상태를 읽는다. 향후 플러그인 자체 stdio 발견이 동작하게 되면 native와 같은 서버를 중복 활성화하지 않고 Pankeki 항목만 정리한다.

native 복원은 전용 Python의 `scripts/register_native.py remove`로 **이 기록이 만든 동일 항목**만 제거한다. plugin/marketplace 제거와 독립적이다. 기존 Codex 설정의 native 항목 추가 이외 값은 등록 전 해시 재구성으로 보존을 확인했다. CLI가 기존 node_repl의 빈 args=[]를 생략하고 timeout 120을 120.0으로 저장한 표현 차이는 기록했으며 동작 값은 같다.

이번 실행기 command/args는 워크스페이스의 `plugins/pankeki-local/scripts/launch.py`를 가리킨다. launcher가 같은 워크스페이스의 server를 전용 Python으로 exec한다. 설치 사본/캐시는 분리된 스냅샷이며 캐시에서 서버가 실행됐다고 주장하지 않는다. source·staged copy·installed cache의 최종 서버 해시를 모두 대조한다. P2 수정 때문에 0.1.0을 보존 기록으로 남기고 지원되는 CLI remove/add로 최종 0.1.2 사본을 갱신하며, 단순 도구 미노출 때문에 재설치를 반복하지 않는다.

정확한 최신 설치 기록 경로는 최종 release 보고서의 `installation_record`가 기준이다. 초기 install-record.json은 0.1.0 이력이며 install-record-0.1.1.json은 P2 갱신 이력이다. 최종 기록은 install-record-0.1.2.json이다. 복원 시 대상 버전의 정확한 --record 경로를 전달한다.

공식 근거: [Codex MCP 설정](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)의 stdio add/env·list·config 범위, [플러그인 패키지](https://developers.openai.com/plugins/build/plugins)의 portable/호환 구성·로컬 marketplace 지침을 확인했다. 현재 호스트의 실제 발견 결과를 문서의 일반 지원 설명보다 우선해 기록한다.

## 완료 판정과 현재 증거

별도 MCP client의 성공, Codex의 설치/등록·해당 채팅 도구 노출, QA의 실제 SDXL/부분수정 성공은 별도로 기록한다. 현재 채팅에 hot reload되지 않으면 host 제약/필요 재연결을 보고하며 새 채팅을 임의 생성하지 않는다.

최종 검증/설치/QA 인계 보고는 `runtime/macos/pankeki-mcp-20261023/release/`에 남긴다. 패키지 파일의 존재나 상태 GET만으로 실제 생성/품질 통과를 선언하지 않는다.

기존 사람형 원화/몸·눈·입은 총괄이 역할 정정 전 Codex image_gen으로 만든 외부 초안이며 imported-external-art technical validation 이력을 보존한다. 사용자 무릎 품질 이의·전신 미술 최종 수용 미완료·해당 소재의 완성/최종 패키징 중단은 유지한다. 이번 MCP 연결 구현은 그 소재를 앱 자체 제작으로 바꾸지 않는다.
