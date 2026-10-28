# 출시 준비 담당 재개 인계

2026-10-20 KST. 첫 준비 결과를 남겼으며 총괄 검토를 기다린다. 다음 공개 갱신의 우선 차단 항목은 **최신 모델 catalog와 기존 공개 설정 예제의 불일치**, 현재 가중치/가상환경 부재, SDXL 출처 고지 누락이다. 생산 코드/README/공개 스냅샷/QA 결과/복구 백업은 수정하지 않았다. 원격 조회·게시·push·제출·메시지·설치·GPU 생성은 수행하지 않았다.

## 완료 사항

- 지정 인계 3개를 순서대로 읽고 최신 shutdown 체크포인트를 기준으로 삼았다.
- 로컬 공개 스냅샷 54개를 현재 소스와 해시 비교했다. 게시 기록 manifest의 53개는 모두 일치한다. 원격 main과 현재 동일하다고 판단하지 않았다. `.git`은 두 복원 폴더 모두 없다.
- 최종 10:48 KST 비교는 전체 54개 기준 동일 34/변경 13/스냅샷 전용 7개다. 게시 목록 기준은 동일 34/변경 12/전용 7개다. 신규 `pankeki/model_presets.py`가 공개본에 없는 점과 SDK adapter 자체는 기존 공개본과 같은 점을 구분했다. 재개 중 디자인 담당의 템플릿/CSS 변경도 포함하므로 전부 10월 19일 변경으로 해석하지 않는다.
- 기존 direct/sdk 예제 2개는 최신 `configured_models`로 읽으면 기본 모델이 없음을 오프라인 재현했다. 새 UI 공개 시 설정·문서를 함께 옮겨야 한다.
- README/실행 안내/라이선스·모델 출처/공개 제외 정책을 정적으로 검토하고 R01–R12 수정 목록과 적용 판정을 작성했다. SDK 8188/8189/8190 및 격리 실행기, 새 manifest 순서를 정리했다.
- 공개 스냅샷 비밀값·개인경로 등 패턴 검출 0건. 최신 대응 후보에서 `tests/test_model_lease.py:61`의 개인 경로 주석 1건을 기록했다. 매칭 값은 로그/문서에 복사하지 않았다. 공개 복사본에서 일반화할 작업이며 다른 담당 파일은 수정하지 않았다.
- 저장 SDK 사례 9개는 모두 succeeded/official SDK/native sampler 실행 기록과 연결되고 PNG hash가 일치했다. 과거 이미지 품질 전체 요구 통과 0건이라는 인계 판정을 유지했다.
- 기존 공개 화면을 육안 확인했고 공개 PNG 2개에 text/EXIF chunk가 없음을 확인했다. 새 화면·영상은 별도 검토해야 한다.
- QA 최종 인계와 원자료를 읽기만 했다. 대회 공식 요건 재조사는 기획팀 담당으로 남겼다.

## 실제 작성 파일

총괄용 문서:

- `docs/releases/2026-10-20-release-readiness.ko.md`
- `docs/releases/2026-10-20-release-runbook.ko.md`
- `docs/handoffs/resume-release.md`

재현 도구:

- `work/team-resume/release/audit-local.ps1`
- `work/team-resume/release/check-config-compatibility.py`
- `work/team-resume/release/check-existing-evidence.py`

실행 결과:

- `work/team-resume/release/local-comparison.json`
- `work/team-resume/release/audit-summary.json`
- `work/team-resume/release/publication-static-scan.json`
- `work/team-resume/release/current-candidate-static-scan.json`
- `work/team-resume/release/config-compatibility.json`
- `work/team-resume/release/existing-evidence-check.json`
- `work/team-resume/release/public-image-metadata.json`
- `work/team-resume/release/runtime-config-shape.json`
- `work/team-resume/release/deliverable-verification.json`

## 검증 명령과 결과

`D:/Pankeki`에서 실행했다. Python은 현재 번들 3.12 실행기의 절대 경로로 실행했으며 `-B`를 사용했다. 자세한 명령은 runbook에 있다.

| 명령 | 결과 |
| --- | --- |
| `& ./work/team-resume/release/audit-local.ps1` | exit 0, 게시 53/53 SHA256 일치, 비교 중 변경 0, 공개 패턴 0/최신 후보 개인경로 1 |
| `python -B work/team-resume/release/check-config-compatibility.py` | exit 0, 예제 2개 모두 UI available default 없음 |
| `python -B work/team-resume/release/check-existing-evidence.py` | exit 0, PNG hash 9/9 일치, SDK/native sampler 9건, 공개 PNG 잠재 text/EXIF chunk 0 |
| `git diff --no-index` 핵심 소스 비교 | exit 1은 차이 존재. engine/server 변경 근거로만 사용 |
| Python stdlib `ast.parse`/`json.loads` 및 로컬 Markdown 링크·소스 hash 재검사 | exit 0, Python 도구 2개 문법 정상, 문서 3개 링크 누락 0, 비교 후 소스 변경 0. `deliverable-verification.json`에 보존 |
| PowerShell `Parser.ParseFile`로 `audit-local.ps1` 구문 검사 | exit 0, parse error 0 |

별도 QA 기록 `work/team-resume/qa/20261020T104118+0900/summary.json`과 최종 `resume-qa.md`는 Python 핵심 111개 실행/110통과/1skip, workflow bridge 17통과, Node 58통과, SDK bridge 12개 실행/7통과/5error다. 합계 198개 중 192통과/5error/1skip이며 SDK error는 `comfy_sdk` 누락이다. 검사 후 템플릿/CSS 2개가 바뀌어 QA 최종 소스 승인과 구분해야 한다. 번들 NumPy는 2.3.5로 앱 lock의 2.5.4와 다르다. 이 담당이 전체 회귀를 재실행한 결과가 아니다.

## 한계와 다음 작업

현재 가중치 2개와 앱/Comfy/SDK venv는 없고, QA 환경 조사 시 8188/8189/8190 listener가 없었다. 현재 새 GPU 생성·브라우저 E2E·신규 PC 설치·`pip check`를 통과했다고 주장하지 않는다. 과거 PID/guard는 다시 만들 대상이다. 이미지 9개는 자동 재실행하지 않았다.

민감값 검사는 공개본 54개 및 현재 대응 후보+신규 preset 48개 범위의 heuristic 검사다. 전체 내부 문서/산출물이나 미선정 새 파일의 공개 승인이 아니다. root의 ignore와 공개본 ignore가 다르고 내부 docs/work/evidence에는 개인 상태가 있으므로 전체 폴더 `git add` 방식은 피한다. 이 인계와 release 증거도 내부 기록이며 통째 공개 대상이 아니다.

총괄은 기능/디자인 변경 확정 → 디자인 담당 최종 빌드 → QA 최신 결과/환경 복구 판단 → 브라우저 및 필요한 최소 SDK smoke → 공개 예제/README/고지와 선별 후보 준비 → 기획팀 공식 요건 확인 → 최종 공개 후보 검토 순서로 진행하면 된다. 세부 통합 절차와 재현 명령은 release runbook을 따른다.

첫 준비 결과 이후 새 담당/하위 에이전트를 추가하지 않았고 다른 채팅에 메시지를 보내지 않았다. 후속 범위는 총괄의 검토 결과를 기다린다.
