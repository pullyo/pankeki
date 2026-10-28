# Mac 품질 도구 설치·사용 결과

작성일: 2026-10-22 KST · 담당: Pankeki Mac 출시 엔지니어
프로젝트: `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki` (이하 로컬 경로는 프로젝트 기준).
배정 기준: `docs/team-macos-20261022/quality-sprint.md`.

## 완료 범위

공식 GitHub 저장소의 최신 안정 릴리스에서 **Ruff 0.17.1, ast-grep 0.51.0**을 받아 `.tools/codex-quality-tools/bin/`에 설치했다. 실제 호스트는 `Darwin / arm64`이며, 두 실행 파일 모두 `file` 검사에서 `Mach-O 64-bit executable arm64`였다. `--version` 실행은 각각 `ruff 0.17.1`, `ast-grep 0.51.0`으로 종료 코드 0을 반환했다. 전역 설치·기존 venv·셸/PATH 설정 변경은 없다.

Ruff로 관련 Python 23개 파일을 읽기 전용 검사하고, ast-grep로 Python/JavaScript 요청·마스크 경계에 **15개 구조 검색 / 18개 일치**를 얻었다. 제품 코드·실행기·모델·서버·공유 브라우저는 변경하거나 조작하지 않았다. 추론·제품 테스트·빌드는 실행하지 않았다. 설치와 정적 검사 완료이며 이미지 품질 개선이나 출시 완료 판정은 아니다.

## 출처·릴리스·라이선스

| 항목 | Ruff | ast-grep |
|---|---|---|
| 공식 저장소 | [astral-sh/ruff](https://github.com/astral-sh/ruff) | [ast-grep/ast-grep](https://github.com/ast-grep/ast-grep) |
| 확인한 안정 릴리스 | [0.17.1](https://github.com/astral-sh/ruff/releases/tag/0.17.1), 2026-10-15 15:24:28 UTC 공개 | [0.51.0](https://github.com/ast-grep/ast-grep/releases/tag/0.51.0), 2026-10-15 15:10:15 UTC 공개 |
| 릴리스 API | [release 413968565](https://api.github.com/repos/astral-sh/ruff/releases/413968565) | [release 413954451](https://api.github.com/repos/ast-grep/ast-grep/releases/413954451) |
| 선택 자산 | [ruff-aarch64-apple-darwin.tar.gz](https://github.com/astral-sh/ruff/releases/download/0.17.1/ruff-aarch64-apple-darwin.tar.gz), 9,189,931바이트 | [app-aarch64-apple-darwin.zip](https://github.com/ast-grep/ast-grep/releases/download/0.51.0/app-aarch64-apple-darwin.zip), 8,626,879바이트 |
| 라이선스 | [고정 태그 LICENSE](https://github.com/astral-sh/ruff/blob/0.17.1/LICENSE): MIT, 포함된 타 라이브러리 고지도 보존 | [고정 태그 LICENSE](https://github.com/ast-grep/ast-grep/blob/0.51.0/LICENSE): MIT |
| 설치 바이너리 | `.tools/codex-quality-tools/bin/ruff` | `.tools/codex-quality-tools/bin/ast-grep` |

두 릴리스 모두 공식 `/releases/latest` 응답의 `draft=false`, `prerelease=false`를 확인한 뒤 고정 태그 자산을 선택했다. API 조회 시각·asset ID·크기·게시 digest와 라이선스 URL/원본 Git blob SHA는 `evidence/release-selection.json`에 보존했다. 경로의 `evidence/`, `downloads/`, `licenses/`는 모두 `.tools/codex-quality-tools/` 하위다.

라이선스 전문은 `licenses/ruff-LICENSE`, `licenses/ast-grep-LICENSE`에 저장했다. 원본 Git blob SHA는 각각 `655a0c76fc5539b2f8e63b673741a5fd0e0c5799`, `f15282f90a7158c2d9f1fedef55438bf9f5c37b0`이며 로컬 전문과 일치했다(`evidence/license-integrity.json`).

## 다운로드·무결성·설치 확인

GitHub 연결로 공식 릴리스 메타데이터와 라이선스를 확인했다. 연결은 바이너리 다운로드를 지원하지 않아 HTTPS curl을 사용했다. 최초 샌드박스 요청은 `Could not resolve host: github.com`으로 실패했고, 규칙에 따라 `require_escalated` 요청으로 공식 자산 2개와 Ruff 체크섬 파일을 받아 종료 코드 0을 확인했다. 다운로드 스크립트나 `curl|sh`는 실행하지 않았다.

| 대상 | 공식 게시값과 일치한 아카이브 SHA256 | 설치 바이너리 SHA256 |
|---|---|---|
| Ruff | `1c8e6e36538eaa0b996378a20c226403c4ca6369ac24884751b024d3a9530b86` | `1cd36902264ba39d8eada510c026a44236ddb55f67937694d8a22b2708fdc0e0` |
| ast-grep | `e18e13c27ed6c4b3ec4de00745b0755dee9dc26c035e226f4dd5d147dca99cc8` | `6e4e64393e1cbc67b68f56606982c2834e9ffe771cf10d4811de0f4d15ee3a6d` |

아카이브 크기·SHA256은 공식 릴리스 API의 asset `size`·`digest`와 대조했다. Ruff는 [게시된 .sha256](https://github.com/astral-sh/ruff/releases/download/0.17.1/ruff-aarch64-apple-darwin.tar.gz.sha256) 내용도 일치했으며, 체크섬 파일 자체의 API digest도 검증했다. 설치 바이너리 SHA256은 검증된 아카이브에서 선택한 파일을 추출한 후 계산한 로컬 기록이다. 별도 서명·attestation 검증을 수행했다는 뜻은 아니다.

실행 전에 tar/zip 항목을 열람하고 절대경로·상위경로 탈출·링크를 검사했다. Ruff 아카이브의 `ruff-aarch64-apple-darwin/ruff`, ast-grep 아카이브의 `ast-grep`만 전용 `bin/`에 0755로 저장했다. ast-grep의 `sg` 보조 파일은 설치하지 않았다. 받은 아카이브는 재대조용으로 `downloads/`에 보존했다. 전체 항목·해시·설치 파일 크기는 `evidence/integrity.json`, 버전 실행값은 `evidence/versions.json`에 있다. 전용 폴더 사용량은 약 90 MiB다.

## Ruff 실제 검사와 해석

공통 옵션은 `check --isolated --no-cache --no-fix --target-version py312 --output-format json`이다. 저장소·사용자 lint 설정을 적용하지 않고 도구 기본 규칙으로 검사했으며 자동 수정·캐시 쓰기를 요청하지 않았다.

대상은 `pankeki/*.py` 15개, `scripts/run_macos.py`, `scripts/verify_sdxl_macos.py`, `tests/test_engine.py`, `tests/test_composite.py`, `tests/test_planning.py`, `tests/test_adapter.py`, `tests/test_server.py`, `tests/test_jobs.py`로 총 23개다. 테스트 파일도 정적 검사 입력으로만 읽었다.

| 검사 | 실행 결과 | 범위와 의미 |
|---|---|---|
| Ruff 0.17.1 기본 규칙 | 종료 1, 39건 | `I001` 12, `B023` 7, `BLE001` 6, `C408` 4, `TRY004` 4, `SIM117` 2, `F401`·`S110`·`UP017`·`UP035` 각 1. 전체 lint 통과로 보고하지 않는다. |
| `--select E9,F63,F7,F82` 추가 실행 | 종료 0, 0건 | 문법 오류·일부 잘못된 제어문/비교·미정의 이름 등에 집중한 제한 검사. 다른 규칙 경고가 해소됐거나 실행·추론이 정상이라는 증거는 아니다. |

분류와 이번 작업 관련성:

- import 정렬·표현 단순화·최신 표기(`I001/C408/SIM117/UP017/UP035`)는 합계 20건이다. 이번 품질 변경과 분리할 유지보수 후보이며 일괄 수정하지 않았다.
- `tests/test_jobs.py:2`의 `F401`은 미사용 `time` import 1건이다. 이번 담당이 추가한 코드에서 나온 경고가 아니다.
- `pankeki/jobs.py:127-131`의 `B023` 7건은 worker 루프의 `preview`가 `job/gate`를 포획하는 구조다. 관련 runner는 139행에서 동기 호출된다. 반환 후 늦은 callback이 가능한지 별도 계약 확인이 필요한 후보로 남기며, 실제 경쟁 오류를 재현했다고 판정하지 않는다.
- `BLE001/S110/TRY004` 11건은 예외 처리·예외 타입 정책 관련이다. 상위 HTTP 오류 처리와 모델/실행 실패 처리를 검토해야 하므로 자동 수정하지 않았다. 마스크 픽셀 훼손이나 부분 수정 지시 실패의 원인이라는 근거는 없다.

원본 결과는 `evidence/ruff-default.json`, `evidence/ruff-error-focused.json`과 각 stderr 파일에 보존했다. 이번 담당은 Python 제품 코드를 바꾸지 않았으므로 전후 lint 개선을 주장하지 않는다.

## ast-grep 실제 구조 검색과 유용한 결과

모든 검색은 `run --lang python|javascript --pattern ... --json=compact --threads 1`을 사용했고 rewrite·interactive·update 옵션은 사용하지 않았다. 15개 검색 모두 종료 0으로 일치 항목을 얻었다.

| 확인한 경계 | 실제 일치 위치와 의미 |
|---|---|
| 스타일과 실제 요청 prompt | `redesign.js:37`의 `preparePrompt(...)` 대입 1건, `app.js`의 `Design.buildPrompt(...)` 2건(254행 표시용, 420행 실제 요청), `profiles.js:118`의 `return brief.prompt` 1건. `useBrief=false`일 때 brief 확장을 우회하지만, 스타일 준비와 brief 확장은 서로 다른 경계다. |
| 원본·마스크·전송 | `app.js:431`에서 `request.source = sourceDataURL`, `request.mask = paint.toDataURL('image/png')` 각각 1건. 480행의 `api('/api/jobs', {session,request})` 1건으로 전송 경계를 찾았다. |
| 서버 수신·검증 | `server.py:101`의 `engine.validate_request(body['request'])`, 102행의 `manager.submit(body['session'], recipe)` 각각 1건. UI 요청과 엔진 입력 사이의 점검 위치다. |
| 모델 마스크 연결 | `engine.py:284`의 `ImageOps.invert(...)`, 288행의 `inpaint(...)`, `workflows.py:27`의 sampler 입력 update 각각 1건. 원본/마스크를 업로드 alpha로 만들고 latent mask와 denoise를 연결하는 위치다. |
| 최종 픽셀·alpha 보존 | `engine.py`의 `putalpha(...)` 3건(259·284·325행), `composite(...)` 323행 1건, `composite.py:36`의 feather support를 제한하는 `np.minimum(...)` 1건, `engine.py:336`의 영역 밖 RGB 오차 실패 guard 1건. 특히 최종 원본 alpha 복원은 325행이다. |

위 표의 JS 파일은 모두 `web/src/`, Python 파일은 모두 `pankeki/` 아래다. 상세 패턴·argv·종료 코드·일치 텍스트·행 번호는 `evidence/analysis-summary.json`과 각 검색 ID의 JSON에 있다.

실무상 다음 조사에 바로 쓸 수 있는 결과는 **부분 수정 요청에도 스타일 suffix와 전체 캐릭터 brief가 합쳐질 수 있는 경계**, **추론용 마스크 반전과 최종 원본 alpha 복원이 별도 단계인 경계**를 특정한 것이다. 프론트/이미지 AI/QA 담당이 같은 위치를 기준으로 실제 요청·workflow·전후 이미지를 대조할 수 있다. 구조 일치는 실제 이미지 지시 준수·형태 유지·경계 품질 합격을 증명하지 않는다.

재사용 예시(프로젝트 루트에서 실행):

```bash
.tools/codex-quality-tools/bin/ruff check --isolated --no-cache --no-fix --target-version py312 --select E9,F63,F7,F82 pankeki scripts/run_macos.py scripts/verify_sdxl_macos.py tests/test_engine.py tests/test_composite.py tests/test_planning.py tests/test_adapter.py tests/test_server.py tests/test_jobs.py
.tools/codex-quality-tools/bin/ast-grep run --lang javascript --pattern '$REQUEST.mask = $CANVAS.toDataURL($MIME)' --json=compact web/src/app.js
.tools/codex-quality-tools/bin/ast-grep run --lang python --pattern 'ImageOps.invert($MASK)' --json=compact pankeki/engine.py
```

## 검증 한계·변경 파일·다음 인계

검사한 Python 23개·JS 4개 파일은 검사 전후 및 최종 확인까지 SHA256이 동일했다(`evidence/source-hashes-before.json`, `source-hashes-after.json`, `analysis-summary.json`). 이후 다른 담당의 제품 변경은 해당 스냅샷과 구분하고 필요한 파일만 다시 검사해야 한다. 이번 도구 설치만으로 기존 39건을 신규 회귀로 분류하지 않는다.

변경 범위는 `.tools/codex-quality-tools/`의 바이너리·다운로드·라이선스·검사 근거와 이 문서 `docs/team-macos-20261022/quality/mac-tooling.md`다. 온보딩 인계·제품 코드·공통 문서는 수정하지 않았다. 추가 도구·패키지·모델·채팅·하위 에이전트는 만들거나 설치하지 않았고 다른 채팅으로 메시지를 보내지 않았다. 총괄은 이 문서와 `analysis-summary.json`을 읽어 취합할 수 있다. 다음 배정을 기다린다.
