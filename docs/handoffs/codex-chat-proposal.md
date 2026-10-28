# Codex 연결 채팅 최소 계약 제안 — 2026-10-20 KST

**최신 판정: 기존 ChatGPT 인증 재사용과 프로세스 한정 비활성화 설정의 적용을 확인했다. 셸·앱·훅·하위 에이전트·원격 플러그인·검색 및 설정된 직접 MCP 서버를 제어할 수 있으므로, 프로토콜 allowlist 부재만으로 통합 불가능이라고 판단하지 않는다. 실제 thread의 도구 집합 확인과 HTTP 계약 검토 전까지 생산 코드는 보류한다.** 모델 추론은 OpenAI 원격 서비스에서 이루어지며 로컬 LLM/이미지 GPU와 별개다. 아래 최초 실패 기록보다 후속 확인이 최신이다.

## 실현 가능 설정 — 설치 버전 추가 실측

동일 `0.163.0-alpha.10.2` 실행기의 `features list`와 공식 `config/read {includeLayers:false,cwd:"D:/Pankeki"}`를 정상 홈을 인식하는 제한 밖 조사 프로세스에서 실행했다. 설정은 CLI `-c`로 **해당 자식 프로세스에만** 전달했으며 전역 설정을 쓰지 않았다. 원본 config 응답·서버 이름·인증 파일은 출력/저장하지 않았다. 비교 결과만 `work/team-resume/function/codex-config-inspection.json`에 보존했다. thread/start·turn/start는 계속 0회다.

| 확인 대상 | 프로세스 한정 적용과 실측 결과 |
| --- | --- |
| 셸·앱·훅·하위 에이전트·원격 플러그인 | `features.shell_tool=false`, `features.apps=false`, `features.hooks=false`, `features.multi_agent=false`, `features.remote_plugin=false`가 설치 버전에서 stable 키로 인식됐고, 덮어쓴 `features list` 및 `config/read`에서 모두 false였다. |
| 부가 자동 동작 | `features.shell_snapshot=false`, `features.skill_mcp_dependency_install=false`도 같은 방식으로 false 적용을 확인했다. |
| 검색·앱 기본값 | `web_search="disabled"`, `apps._default.enabled=false`를 config/read로 확인했다. 앱은 기본값 한 개만 믿지 않고 위 apps feature도 false로 둔다. |
| 직접 MCP 서버 | **`mcp_servers={}`는 상속된 설정을 비우지 않았다.** config/read에서 얻은 서버 ID를 출력하지 않고 메모리에서만 사용해 `mcp_servers={"ID"={enabled=false},…}` 인라인 표를 CLI 인자로 전달하자, 실효 설정의 모든 직접 MCP 항목이 enabled:false가 됐다. 점으로 결합한 개별 키 방식은 두 시도에서 프로세스 exit1이어서 채택하지 않았다. |

적용은 예를 들어 `-c features.shell_tool=false`처럼 CLI 인자 배열로 전달한다. MCP 인라인 표에는 **현재 확인한 모든 ID**를 넣어야 하며, 실제 인자를 로그로 남기지 않는다. 사용자 파일의 설정을 지우거나 별도 HOME/CODEX_HOME·인증 복사본을 만들 필요가 없다. `unified_exec`는 독립적으로 켜져 있을 수 있으므로 이를 끄는 것만을 셸 차단으로 보지 않는다.

[공식 config-basic](https://learn.chatgpt.com/docs/config-file/config-basic), [config-sample](https://learn.chatgpt.com/docs/config-file/config-sample)의 feature/MCP 구조와 일치하는 제어 경로다. 설치 버전의 `ConfigReadResponse.ToolsV2`는 web_search 설정만 노출하지만, features 및 MCP 실효 설정은 config/read에서 별도로 확인할 수 있었다. 따라서 프로토콜에 내장 도구 allowlist가 없다는 사실과 설정으로 제한할 수 없다는 주장은 구분한다.

남은 확인은 **파일 패치·컴퓨터/브라우저 등 다른 내장 도구와 플러그인 자동 추가까지 포함한 실제 thread의 도구 집합**이다. 이번 범위는 설정 조사이므로 그 검증을 위해 thread/turn을 만들지 않았다. 설정 지원과 적용은 확인됐지만, “도구 0개가 실제 모델에 제공됐다”는 최종 보장은 아직 하지 않는다. HTTP 계약/사전 사용자 검토가 끝나기 전 구현도 하지 않는다.

## 총괄 요청 재시도 및 생성 스키마 확인

- 같은 실행기·작업 위치에서 `require_escalated`로 **1회** 실행했다. `initialize → initialized → account/read {refreshToken:false}` 성공, 최소 응답은 `authenticated:true`, `type:"chatgpt"`였다. `requiresOpenaiAuth:true`는 이 실행기가 인증을 요구한다는 필드이며, 이미 account가 있는 이번 응답을 로그인 필요 상태로 해석하지 않는다. 새 로그인은 현재 필요하지 않다.
- 이는 공식 API가 보고한 저장 인증 상태 확인이다. `refreshToken:false`였고 원격 모델 turn은 보내지 않았으므로, 추론 요청 시점의 토큰 유효성·계정 한도·모델 접근까지 검증한 것은 아니다.
- 재시도 승인 거절은 없었다. HOME/CODEX_HOME 등 홈 위치를 덮어쓰지 않았고, 인증 파일·토큰·이메일을 읽어 출력하거나 복사하지 않았다. 공식 프로세스가 관리하는 기존 인증을 account/read로만 확인했다. thread/start·turn/start·추론·로그인·한도 소비/구매 요청은 **0회**다. 확인 후 조사 자식 프로세스를 종료했다.
- 최초 일반 실행 실패와 제한 밖 성공은 **조사 환경/실행 권한 차이의 영향**을 보여준다. 정확히 어느 홈 탐색 단계나 환경 제한이 원인이었는지는 미확정이며 Pankeki 실제 서버도 같은 정상 실행 조건에서 동작해야 한다. 앱 자체를 무제한 권한으로 실행하라는 뜻은 아니다.
- `app-server generate-json-schema --experimental --out D:/Pankeki/work/team-resume/function/codex-protocol-schema`는 일반 실행에서도 exit0이었다(home 경고는 남음). 출력은 이 바이너리의 정적 프로토콜 스키마이며 사용자 인증 내용이 아니다. 요약·관련 파일 SHA256: `work/team-resume/function/codex-protocol-inspection.json`.

| 실제 생성 스키마 | 확인된 필드와 제한 |
| --- | --- |
| `v2/ThreadStartParams.json` | `config`는 임의 JSON map, `dynamicTools`는 추가 도구 정의 배열이다. 이 배열을 비운 것을 내장 도구 제거로 간주할 근거는 없다. `sandbox`, `approvalPolicy`, `permissions`(이름 있는 프로필 ID)가 존재한다. |
| `v2/TurnStartParams.json` | `outputSchema`, `sandboxPolicy`, `approvalPolicy`, `disabledPluginIds`가 있다. 직접적인 내장 도구 allow/deny 목록이나 `toolChoice` 필드는 없다. `readOnly` 정책에는 `type`과 boolean `networkAccess`만 있고, 최신 문서의 `access/readableRoots` 제한 읽기 구조는 이 스키마에 없다. |
| 같은 스키마의 `AskForApproval` | 문자열 값은 `untrusted`, `on-request`, `never`다. 최신 문서의 다른 표기를 그대로 복사하지 않는다. 어느 값도 내장 도구 전부 끄기를 의미하지 않는다. |
| `v2/ThreadStartResponse.json` | `instructionSources`, `disabledPluginIds`, `activePermissionProfile`, `sandbox`를 반환하도록 정의돼 있다. 향후 승인된 thread 점검에서 설정 상속과 실제 권한을 확인할 접점이다. 이번에는 thread를 만들지 않았다. |

스키마 생성에 `--experimental`을 사용한 것은 필드 조사 범위일 뿐 실제 연결에서 실험 API를 켰거나 그 필드가 정상 작동한다고 검증했다는 의미는 아니다. `config`가 열린 map이므로 프로토콜 JSON 스키마만으로 `tools.disable_defaults` 같은 설정의 존재나 효과를 증명할 수 없다. **파일/셸/외부 MCP를 실행하지 않는 구성이 검증되기 전 원격 turn을 보내지 않는 조건을 유지한다.**

## 실제 확인

- 실행기: `C:/Users/Administrator/AppData/Local/OpenAI/Codex/bin/896a0166b774037a/codex.exe` (`Get-Command codex`로 발견). 버전 `codex-cli 0.163.0-alpha.10.2`.
- 최초 조사에서 `--version`, `app-server --help`, `app-server generate-json-schema --help` 성공. stdio 및 스키마 생성 명령이 존재함을 확인했고 이후 위 재시도 단계에서 스키마도 생성했다. 버전 변경 없음. `where.exe codex`는 검색하지 못하므로 PATH만 믿지 말고 발견된 절대 경로를 설정한다.
- 숨긴 자식 프로세스의 stdio에서 `initialize`를 요청하고 응답 뒤에만 `initialized`/`account/read {refreshToken:false}`를 보내도록 읽기 전용 점검했다. 프로세스가 즉시 **exit1 / `Could not find home directory`**로 종료해 initialize 응답과 account/read에 도달하지 못했다. 실행기 help에서도 같은 home 경고가 있었다. 이를 로그인 만료나 계정 없음으로 해석하지 않는다. 권한 차단인지 환경 변수/호스트 실행 조건 문제인지도 아직 확정하지 못했다.
- 인증 파일·토큰·키·계정 이메일은 열거나 출력·복사하지 않았다. thread/turn·로그인·결제 요청, MCP 작업, 모델 추론도 실행하지 않았다. 생산 코드 변경 없음.

## 연결·인증·호환성

[공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)에 따라 `initialize → initialized → account/read → thread/start → turn/start`를 사용한다. 응답은 `item/agentMessage/delta`, `turn/completed`로 수집하고 취소는 `turn/interrupt`다. 정확한 로그인 메서드는 **`account/login/start`**다. 브리지는 Pankeki 서버가 자식 프로세스로 소유하고 stdio만 사용한다.

제한 밖 재시도의 공식 account/read로 ChatGPT 인증이 확인됐으므로 정상 실행 조건에서 Codex가 관리하는 기존 인증을 사용할 수 있다. 앱 로그인 사실만으로 추정한 결과가 아니다. 향후 계정이 없거나 인증이 만료된 경우에만 사용자 선택으로 공식 ChatGPT 로그인 흐름을 시작하고 사용자가 브라우저에서 완료한다. 새 API 키·유료 계정·크레딧 구매·한도 리셋 소비·API 과금으로의 자동 전환은 하지 않는다.

설치 버전은 alpha이므로 초기화 응답과 해당 실행기의 생성 스키마로 실제 필드 지원을 대조한 뒤 고정한다. 문서 예제의 모델명을 그대로 박지 않고 인증 계정의 공식 모델 목록 중 사용자가 선택한 모델을 쓴다. 초기 상태에서 `experimentalApi:false`; 안정 API만으로 제한 요구를 충족하지 못하면 구현 가능으로 표시하지 않는다.

## 도구·파일 제한: 구현 진입 조건

`readOnly`는 읽기/일부 셸 실행까지 막는 설정이 아니고 `approvalPolicy:never`도 모든 도구 비활성화가 아니다. 프롬프트의 “도구를 쓰지 말라”만으로 이 요구를 충족했다고 표시하지 않는다.

[공식 설정 참조](https://developers.openai.com/codex/config-reference)의 셸 feature, MCP 서버/플러그인 서버 `enabled`, 앱 활성화, 검색 설정 등을 **설치 버전의 실제 설정·도구 목록과 대조**하여 셸·파일 편집·외부 MCP/앱·검색·하위 에이전트를 모두 제거해야 한다. 미지원 키를 무시한 상태로 실행하지 않는다. 초기화는 재시도로 해결했지만 모든 도구를 제거하는 단일 옵션은 확인되지 않았고, Windows 제한 읽기 정책도 실제 실행 검증 전이다.

공식 참조에서 확인한 구체적 설정은 `features.shell_tool=false`, `apps._default.enabled=false`, `mcp_servers.<id>.enabled=false` 등이다. 앱별 활성화가 기본값을 덮어쓸 수 있으므로 기본값 한 개만 끄는 것으로 충분하지 않다. `tools.disable_defaults`라는 일괄 옵션은 현재 공식 참조에서 찾지 못했고 생성 프로토콜 스키마도 이를 확증하지 않으므로 지원된다고 가정하지 않는다.

전용 빈 작업 폴더를 사용하고 Pankeki 폴더·사용자 홈·환경 비밀값을 모델 컨텍스트로 넘기지 않는다. 프로젝트 AGENTS/skills/MCP 설정 상속도 차단 대상으로 확인한다. 브리지는 필요한 프로토콜 메서드만 직접 호출하고 `command/exec`, `process/*`, `fs/*`, 외부 MCP 실행은 노출하지 않는다. 예기치 않은 도구/승인/동적 도구 요청은 거부·turn 중단하고 실패를 표시한다. 다만 이미 자동 실행될 수 있는 내부 도구를 사후 거부하는 것만으로는 충분하지 않다. **도구 제거를 사전에 증명하지 못하면 원격 turn을 보내지 않는다.**

## Pankeki HTTP 계약 초안

기존 `Handler.guard`의 loopback 바인딩·Host/Origin·JSON 검사를 모든 채팅 라우트에도 적용한다. 현재 이미지 요청과 큐는 유지하고 채팅 본문은 별도의 작은 상한(초안 64KiB)을 둔다.

| 경로 | 입력·응답 |
| --- | --- |
| `GET /api/chat/status` | `{provider:"codex_app_server",state:"unavailable|login_required|blocked|ready",authenticated:null|false|true,version,capabilities:{text,imageInput},error:{code,message}|null}`. 최신 조사 결과는 authenticated:true지만 도구 제한 미검증이므로 ready가 아니다(초안 표시 blocked/tools_not_verified). 토큰·원본 account 응답·이메일·실행기 내부 경로는 브라우저로 반환하지 않는다. |
| `POST /api/chat/sessions` | `{project_token}` → `{session_id,session_nonce}`. 프로젝트 열기/reset/import마다 새 project_token을 사용한다. 서버가 만든 세션에만 Codex thread를 연결하며 version1 프로젝트 파일에는 넣지 않는다. |
| `POST /api/chat/messages` | `{session_id,project_token,source_revision,client_request_id,message,brief,context:{sourceCandidateId,selectedCandidateIds,hasMask}}` → 202 `{job_id,revision,client_request_id,project_token,source_revision,state:"queued"}`. 파일 경로·원격 URL·raw 프로토콜·셸·모델 권한 설정은 받지 않는다. |
| `GET /api/chat/jobs/{job_id}` | 세션 소유 검증 후 `{state,revision,is_current,client_request_id,project_token,source_revision,text,proposal,error}`. 상태는 queued/running/succeeded/failed/canceled/uncertain. 처음은 polling으로 충분하다. |
| `POST /api/chat/jobs/{job_id}/cancel` | `{}` → 중단 요청. 활성 thread/turn에 interrupt를 보내고 늦은 delta·제안을 폐기한다. 완료 통지가 오기 전 원격 중단 성공으로 단정하지 않는다. |

서버에서 세션 ID와 접근 nonce를 발급하고 `프로젝트+브라우저 세션 → Codex thread`를 따로 보관한다. message/poll/cancel은 `X-Pankeki-Chat-Session` 헤더의 nonce를 요구한다. nonce와 thread ID는 URL·프로젝트 export·일반 로그에 넣지 않는다. 임의의 Codex thread ID를 클라이언트가 지정하거나 다른 Codex 채팅을 이어 쓰지 못하게 한다. 프로젝트마다 동시 turn은 1개, 요청 중복은 session_id+client_request_id로 차단한다. project_token과 source_revision은 클라이언트 상태 상관값이며 권한 증명이 아니다. 서버는 제출값을 모든 결과에 그대로 돌려주고 UI가 현재값과 대조한다. 첫 구현의 재시작 후 대화 복원은 별도 기능이며 자동으로 모든 Codex 이력을 가져오지 않는다.

turn의 구조화 출력은 `{reply,briefPatch,action:{type:"none|prepare_generate|prepare_edit",prompt,sourceCandidateId}}`로 제한하고 백엔드에서 필드·길이·후보 ID를 검증한다. **제안 수신은 이미지 제출이 아니다.** 사용자가 제안을 확인한 뒤 기존 sanitize/요청 검증으로 적용하고, 이미지 생성은 기존 generate를 별도로 명시 호출한다. 대화 완료와 이미지 생성 완료를 분리한다.

## 따뜻한 프론트엔드 계약과의 최소 차이

`docs/handoffs/warm-frontend-implementation.md`와 의미 계약은 일치하며, 그 문서에 고정 HTTP 경로가 없어 경로 충돌도 없다. 최신 인증 성공은 위 기록으로 갱신한다. 프론트엔드 파일은 수정하지 않았다.

1. **연결 준비 상태:** 로그인 성공과 전송 가능을 분리한다. `authenticated:true`여도 tool 제한/모델 준비가 미확인인 blocked 상태에서는 chatSend disabled를 유지한다. 첫 범위는 텍스트 전용으로 imageInput:false이며 후보 이미지 바이트를 보내지 않는다.
2. **세션 발급 및 원본 세대 회신:** 초안에 없던 `/api/chat/sessions`와 nonce 헤더를 위처럼 구체화했다. 프론트가 reset/import/프로젝트 전환마다 project_token을 교체하고, 기존 sourceRevision을 source_revision으로 보낸다. 응답·취소·오류도 client_request_id/token/revision으로 대조하며 원본 교체 후 늦은 응답은 폐기한다. 서버의 is_current만으로 클라이언트 원본 세대의 일치를 보장하지 않는다.
3. **timeout/uncertain:** 프론트 lifecycle에 uncertain 표시를 추가한다. 로컬 대기 timeout은 timed_out으로 표시하되 제출 수락 여부를 모르면 별도 uncertain 사유를 유지하고 자동 재전송하지 않는다. cancel은 원격 interrupt 요청과 로컬 결과 폐기를 구분한다.
4. **제안과 저장:** reply는 textContent, briefPatch/action은 확인 UI에서만 적용한다. 한국어 이름·설명 등 기존 허용 브리프 필드와 prompt 길이 제한을 그대로 사용하고, notes·임의 경로·실행 코드는 생성 동작으로 처리하지 않는다. 제안 수신만으로 후보 저장/이미지 job/원본 교체를 하지 않으며, 대화·nonce·제안은 version1 내보내기에 추가하지 않는다.

이 표기와 토큰 이름은 구현 전 합의할 계약 제안이다. 프론트엔드의 현재 미연결 상태를 해제하거나 구현 완료로 보고하지 않는다.

## 오류·사용자 개입·다음 단계

- 인증 없음/만료: login_required, 공식 로그인 버튼. 로그인 정보·브라우저 승인은 사용자가 직접 처리한다.
- 한도 소진: rate_limited와 공식 응답의 reset/retry 정보만 표시. 추가 구매·리셋·계정 전환을 자동 실행하지 않는다.
- 네트워크/서버 종료/timeout: 안전한 오류로 정리한다. 제출 수락 여부가 불명확하면 uncertain으로 두고 자동 재전송하지 않는다.
- 버전/권한 필드 미지원: incompatible 또는 tools_not_restricted로 차단하고 필요한 버전·정책을 보고한다. 제한을 느슨하게 바꾸지 않는다.

정상 사용자 홈을 인식하는 실행·기존 인증·위 프로세스 한정 설정 적용까지 확인했다. 다음 결정점은 HTTP 계약과 사전 사용자 검토 후 실제 thread의 도구 집합을 확인할 범위를 배정하는 것이다. 현재 배정은 설정 조사까지이므로 thread나 turn을 추가로 만들지 않고 대기한다. 토큰 복사·다른 홈으로 덮어쓰기·무제한 권한 모델 실행으로 우회하지 않는다. **이번 조사는 새 결제 없이 수행했다.** 계정 한도 내 이용 가능 여부는 이후 공식 한도 응답으로 확인한다. 현재 새 로그인은 필요 없으며, 향후 만료 시 공식 로그인·호스트의 실제 권한 요청·원격 전송 안내가 사용자 개입 지점이다. 자동 승인 거절은 관측되지 않았다. 생산 채팅 코드는 계속 보류한다.
