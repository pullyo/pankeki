# 디자인·사용성 재개 인계 — 2026-10-20 KST

상태: 첫 작업 완료, 총괄 검토 대기. 기존 밝은 디자인, 선택된 팬케이크 로고, 채팅·큰 캔버스·후보 구성을 유지했다. 실제 제품 소스 변경은 `web/src/index.template.html`, `web/src/style.css` 두 파일이다. **공유 `web/index.html`은 재빌드하지 않았다.**

## 확인한 현재 흐름과 증거

지정된 순서로 `TEAM-OPERATIONS.ko.md` → `shutdown-checkpoint.md` → `TEAM-CONTEXT.ko.md`를 읽었다. 최신 SDXL/SDK 구현 상태를 기준으로 삼았다. `index.template.html`, `style.css`, `build.py`와 기능 소스의 이벤트 연결을 읽었고, 이전 `design-revision/`의 데스크톱·390px 화면, `model-ui/report.json`, 채팅 DOM 계약·기존 키보드 인계를 확인했다.

- 데스크톱: 왼쪽 대화, 중앙 큰 캔버스, 오른쪽 후보 목록. 긴 생성 설정은 왼쪽 상세 설정 패널에 있다.
- 390px: 대화/결과 탭으로 전환하며, 결과 화면에서는 캔버스 다음에 후보가 이어진다.
- 대화 모델은 미연결이다. `chatSend`는 비활성이고, 예시는 초안 입력용이다. 실제 이미지 생성 경로는 상세 설정의 기존 `generate`다.
- 원본 첨부 또는 후보의 ‘이어서 수정’ → 같은 stage의 원본/마스크 → 마스크 파일 또는 브러시 → 기존 부분 수정 경로를 사용한다.
- 두 후보 선택 → 중앙 비교 → Escape/닫기로 선택 버튼 복귀. 프로젝트 JSON은 이미지·설정·선택 기록을 보관하며 마스크는 다시 입력한다. 브라우저 자동 저장·오프라인 복원도 기존 기능이다.

작업 시작 시 8190 LISTEN이 없었다. 모델·실행기를 설치하거나 기동하지 않고, 설치된 Python/Playwright/Chrome으로 **소스 스냅샷의 격리 프리뷰**를 만들었다. `127.0.0.1:8192` 프리뷰는 읽기 전용이고 모든 `/api/*` GET에 명시적 503을 반환한다. 오류 화면 점검을 위한 조건이며 실제 SDK 서버의 실행 증거가 아니다. 이미지·프로젝트는 기존 `work/character-studio/visual-check/verified-project-with-edit.json`과 저장된 마스크를 사용했다.

## 재현과 수정

1. **모바일 작업 공간 건너뛰기 실패.** 390px 대화 탭에서 건너뛰기 링크를 Enter로 실행하면 `workspace`가 숨겨진 채 남고 포커스도 도달하지 않았다. 링크의 표시 전용 처리에서 결과 탭을 먼저 열고 작업 공간에 초점·스크롤을 이동하도록 수정했다.
2. **이미지 첨부의 키보드 접근·표시 실패.** 원래 첨부 진입점 세 개는 `label`이었으며 네이티브 `upload` 입력은 모바일에서 숨겨진 결과 패널에 있었다. 모바일 대화의 Tab 경로에는 첨부가 없었고, 데스크톱에서도 숨긴 입력의 초점이 대화 첨부에 표시되지 않았다. 진입점 세 개를 네이티브 `button type=button`으로 바꾸고 같은 `upload.click()`에 연결했다. 입력 ID·type·accept와 기존 change 처리기는 유지하며 중복 탭 정지는 제거했다. 버튼의 기존 외형과 간격은 CSS `padding:0`으로 유지했다. Enter/Space의 실제 파일 선택기 이벤트까지 확인했다.
3. **설정 뒤 가려진 대화로 초점 이동.** 상세 설정을 열고 후보 수 선택에서 Tab을 누르면 가려진 대화 예시 버튼에 초점이 갔다. 상세 설정이 열린 동안 덮이는 `.chat-messages`, `.chat-composer-area`에만 `inert`를 적용하고 닫을 때 해제했다. 모달로 바꾸거나 다른 캔버스 조작을 차단하지 않았다.
4. **오프라인 오류가 녹색·체크 표시로 보임.** `#status.error`가 있어도 뒤쪽 `.image-activity #status` 지원 텍스트 규칙이 오류 색을 덮어썼다. 실제 오류 색은 수정 전 `rgb(105,121,96)`이었다. 오류 상태의 우선순위를 바로잡고 기존 성공 체크 대신 경고 표시를 보이게 했다. 장식 아이콘은 `aria-hidden`으로 처리했고 기존 `role=status` 문구는 보존했다.

수정 전 보존 프리뷰에서 46개 검사 중 11개 실패로 위 네 원인을 재현했다. 같은 검사와 새 버튼의 실제 파일 선택기 검사 6개를 수정 후 프리뷰에 실행하여 **52/52 통과**했다. 이전의 후보 카드 포커스 문제는 현재 기능 소스에서 이미 해결되어 있었으며 이번 작업에서 다시 수정하지 않았다.

## 검증 명령과 결과

실행 위치는 `D:/Pankeki`다. 아래 서버는 검증 종료 후 정지했다. 다시 확인하려면 첫 명령을 별도 터미널에서 실행한다.

```powershell
node work/team-resume/design/serve-preview.cjs
node work/team-resume/design/audit.cjs before
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' work/team-resume/design/prepare-preview.py after
node work/team-resume/design/audit.cjs after
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' work/team-resume/design/verify-contract.py
```

- 격리 빌드 성공: `after/preview/index.html`, 1,959,107 bytes, SHA256 `0a9490056771754f1469033128078485141bd88383b44983937c27028e99975a`.
- 실제 Chrome 1440×900·390×844: 빈 대화, 상세 설정, 후보 복원, 비교, 원본/마스크에서 문서 가로폭이 각각 1440·390px로 유지됐다.
- 건너뛰기, 세 첨부 버튼의 파일 선택기, 가시적 초점, 설정 뒤 조작 제외, 도움말 Escape/초점 복귀, 후보 선택 포커스, 비교 진입/Escape 복귀 통과.
- 저장된 후보 3개를 불러와 비교·편집하고 마스크의 검은 바탕에 밝은 픽셀이 생기는 것을 확인했다. 원본·마스크 표시 사각형은 데스크톱 489², 모바일 265²로 일치했다.
- JSON 저장에 후보 3개 유지, API가 계속 503인 새로고침 뒤 IndexedDB 자동 복원으로 후보 3개 유지. 자동 저장 완료/자동 복원 완료 신호를 기다린 뒤 판정했다.
- 페이지 오류 0건, API 쓰기·생성 요청 0건. 파일 선택기는 Playwright의 실제 브라우저 `filechooser` 이벤트를 확인했으며 OS 대화상자 조작은 하지 않았다.
- 계약 검사 통과: 기존 DOM ID 117개 동일, 중복 ID 0개, 누락된 label 대상 0개. `app.js`, `profiles.js`, `build.py`, 선택된 로고, 공유 `web/index.html`은 착수 스냅샷과 SHA256 동일.
- 공유 빌드의 유지 SHA256: `c114081b8094ff11de0949fc957776975348d8ea8defc3840663270af4d7dfc7`.

원시 결과는 `work/team-resume/design/{before,after}/audit.json`, 계약 결과는 `contract.json`, 소스 차이는 `changes.diff`, 빌드 입력과 해시는 각 단계의 `source-manifest.json`에 있다. 격리 빌드는 기능 담당의 동시 작업에 영향을 받지 않도록 `app.js`/`profiles.js`를 착수 시점으로 고정한다. 최종 통합은 최신 기능 소스로 별도 확인해야 한다.

## 화면 증거

`work/team-resume/design/after/`의 실제 브라우저 캡처를 직접 열어 확인했다.

- `1440-chat-offline.png`, `390-chat-offline.png`: 밝은 기존 화면과 미연결 대화·오프라인 오류 표시.
- `1440-attachment-focus.png`, `390-attachment-focus.png`: 대화 첨부의 키보드 초점.
- `1440-settings.png`, `390-settings.png`: 기존 설정 패널과 가려진 대화의 초점 제외.
- `1440-restored-candidates.png`, `390-restored-candidates.png`: 저장된 후보 불러오기.
- `1440-comparison.png`, `390-comparison.png`, `390-comparison-full.png`: 후보 비교. 모바일은 상단과 전체 문서 캡처를 함께 남겼다.
- `1440-source-mask.png`, `390-source-mask.png`: 같은 사각형에 정렬된 원본·마스크.
- `1440-offline-restored.png`, `390-offline-restored.png`: API 오프라인 조건에서 기존 후보 자동 복원.

`before/`에는 대응하는 수정 전 증거를 보존했다. 이 화면의 캐릭터는 이전 실험 결과이며 이번 생성이나 품질 승인으로 표시하지 않는다.

## 실제 변경 파일·계약·한계와 다음 작업

제품 수정: `web/src/index.template.html`, `web/src/style.css`.

신규 인계/검증: 이 파일과 `work/team-resume/design/` 아래 `prepare-preview.py`, `serve-preview.cjs`, `audit.cjs`, `verify-contract.py`, `changes.diff`, `contract.json`, `before/`, `after/`. 후자의 소스 파일들은 격리 빌드용 복사본이다. 복구 기준 백업과 기능 담당 소스는 수정하지 않았다.

DOM ID/API 계약 변경은 없다. 표시 전용 `[data-upload-trigger]` 버튼이 기존 `upload` 입력을 호출한다. 기존 `label[for=upload]` 형태는 세 버튼으로 교체됐으므로 향후 테스트나 확장에서는 버튼 또는 해당 data 속성으로 진입점을 찾는다. 생성·파일 처리·마스크 좌표 로직은 기존 기능 담당 코드가 맡는다.

이번 확인은 기존 설치의 Chrome과 데스크톱/390px 뷰포트에 한정한다. 실제 휴대폰 가상 키보드·터치, Safari/Firefox, 스크린리더, 종합 대비 인증은 수행하지 않았다. 실제 모델 목록 성공·SDK 생성·GPU 품질·부분 수정 출력 픽셀은 이번 프리뷰로 검증하지 않았다. 대화 모델 미연결 상태도 그대로다.

총괄이 기능 담당 완료를 확인한 뒤 공유 `web/index.html` 최종 빌드를 요청해야 한다. 그 시점에 최신 기능 소스와 합친 실제 앱에서 첨부→후보→부분 수정·비교·저장 흐름, 모델 목록 성공/실패 양쪽을 확인하면 된다. 현재는 추가 수정이나 공유 빌드 없이 총괄 검토를 기다린다.

## 통합 완료 — 2026-10-20 KST, 위 최초 인계 이후

총괄이 기능/프론트엔드 1차 검증 완료 및 생산 JS 변경 없음을 확인하고 최종 빌드를 요청했다. 이 요청으로 앞선 ‘공유 빌드 대기’ 상태를 종료했다. **`web/build.py`를 한 번 실행하여 공유 `web/index.html`에 네 결함 수정을 통합했다.** 새로운 디자인·기능 소스 변경, 전수 테스트, 추가 브라우저 촬영은 하지 않았다.

실행 위치 `D:/Pankeki`:

```powershell
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' web/build.py
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' work/team-resume/design/verify-integration.py
```

빌드와 최소 통합 검사 모두 exit 0이다. 공유 산출물은 이미 52/52 브라우저 검사를 통과한 `after/preview/index.html`과 **바이트 단위로 동일**하다. 이에 따라 위 1440×900·390×844 실제 브라우저 화면 및 검증 결과를 재사용한다. 최종 빌드에 대해 브라우저 검사를 새로 수행했다고 주장하지 않는다.

- 최종 파일: `web/index.html`, 디스크 1,960,454 bytes. 빌더의 줄바꿈 변환 전 UTF-8 길이 보고는 1,959,107 bytes다.
- 최종 SHA256: `0a9490056771754f1469033128078485141bd88383b44983937c27028e99975a`.
- 8/8 최소 검사 통과: 검증 프리뷰와 바이트 동일, DOM ID 117개 동일·중복 없음, 빌드 입력/로고 해시 동일, 네이티브 첨부 버튼 3개, 건너뛰기·가려진 대화 inert·오류 표시 수정 포함.
- HTML/CSS·`app.js`·`profiles.js`·`build.py`·선택 로고는 기존 검증 manifest와 같으며 이번 통합에서 소스를 변경하지 않았다. 백엔드와 소유 외 파일도 변경하지 않았다.
- 이번 추가 파일/수정: `web/index.html`, 이 인계, `work/team-resume/design/verify-integration.py`, `work/team-resume/design/integration-build.json`.

통합 증거는 `integration-build.json`에 저장했다. 모델/SDK/GPU 실행과 실제 휴대폰·다른 브라우저에 관한 앞선 한계는 그대로다. 디자인 담당의 이번 배정은 완료이며, 추가 수정 없이 총괄의 통합 결과 검토로 넘긴다.
