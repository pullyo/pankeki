# 움직임 렌더러 실제 Canvas 픽셀 QA

## 최신 판정 — 수집 수정본 독립 재검증 PASS

2026-10-20 KST. 총괄이 D:에 수집한 renderer SHA256 **`70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae`**를 독립 QA가 설치된 **Chrome150.0.7871.47**에서 새 run ID `chrome-fix-70891975`로 실행했다. 실제 origin은 `http://127.0.0.1:8874`, 로드 스크립트는 `retest-70891975/renderer-under-test.js`의 동일 SHA다. 기존 실패를 재현했던 브라우저/viewport1440×900/DPR1을 유지했다. 기술 담당의 성공 기록을 독립 수용 증거로 대신하지 않고 QA가 직접 실행했다.

| 영향 범위 | 수정본 결과 |
|---|---:|
| 기존 raster oracle: 두 삼각형/4×4, alpha0·반투명 경계·배경·겹침·부모 opacity | **17/17**, RGBA 차이0 |
| 기존 회전/기울기 내부 공유 경계 oracle | **8/8**, RGBA 차이0 |
| 추가 비선형4×4 내부 정점 변형: 정렬/회전/기울기 × opacity1/.4 | **6/6**, 내부 alpha/RGBA 최대 오차0 |
| 사전 검증 오류12종 + 최종 보존 확인 | **13/13** |
| 상태 복원·상속 등 별도 assertion | **4/4** |
| 실제 캐릭터 기본 pose vs native/source | **2,502 → 0픽셀** 불일치 |
| 실제 몸체 단독 vs native | **1,934 → 0픽셀** 불일치 |

최소 반투명 재현의 (12,12)는 `[239,80,40,128]`로 기대값과 일치했다. 부모 .5×자식 .4도 경계/내부 모두 기대 alpha51이다. 실제 캐릭터 (408,247)은 `[117,67,33,255]`로 복구됐다. 실제 눈0/입1/호흡1의 정적 PNG를 시각 검수했고 이전의 공유 대각선·세로 밝은 선은 보이지 않았다. 움직인 pose의 정적 캡처를 연속 재생 증거로 확대하지 않는다.

수정본 증거는 모두 `work/team-resume/motion-qa/renderer-pixels/retest-70891975/`에 분리했다. 기존 `pixel-tests.js`/`character-tests.js`는 **동일 바이트**로 복사했고, PNG/project 입력도 최초 실패 때의 고정 입력을 유지했다. 기존 실패 증거 manifest 전체의 바이트 SHA 불변을 재확인했다. 예전 디자인 제공 PNG에는 이음새가 남아 있으므로 수정본과 그 PNG가 다르다는 것은 예상된 결과다. 최신 수용 기준은 native/source와의 일치다.

- `results/chrome-fix-70891975--browser-report.json`, `--character-report.json`, `--launch.json`: 실제 실행·origin·로드 SHA와 픽셀/오류 결과.
- `results/chrome-fix-70891975--nonlinear-report.json`: 추가6조건, 내부 픽셀 수/정점/전 픽셀 통계/PNG/getImageData.
- `retest-provenance.json`, `retest-verification.json`, `retest-evidence-manifest.json`: oracle/고정 입력 불변과 **PNG·RGBA75쌍**의 해시·크기·전체 decode 일치.75쌍은 증거 무결성 수이며 테스트 성공 수가 아니다.
- `results/seam-fix-before-after.png`: 실패본/수정본/native의 실제 캐릭터 비교. `results/moved-poses-visual.png`: 눈0/입1/호흡1 정적 시각 근거.

**RGBA001 공유 경계 결함의 이번 정적 렌더러 수용 범위는 통과로 전환한다.** 저장·재개·48ZIP·성능·사용자 제공 PNG 전체 흐름은 실행하지 않았다. 디자인이 coherent preview build/origin과 실제 연속재생 증거를 전달하면 최소 play → 눈/호흡의 시간별 픽셀 변화 → pause를 먼저 확인하여 첫 시연을 인계한다. 그 확인을 전체 T9 완료와 구분하며 저장/ZIP 검수를 기다려 첫 시연을 늦추지 않는다.

## 최초 실패 기록 — 아래 증거와 판정은 기준 SHA에 한정

2026-10-20 15:32 KST · 독립 QA · **FAIL: 공유 경계 이음새 재현, T4 실제 픽셀 TODO 미종결**

대상은 `web/src/character-renderer.js` SHA256 `f9aee578144a62094140bf404061f9dc9d5e021201e51e521491b5b843fe5b26`다. 디스크 원본, HTTP로 실제 로드한 스크립트, 보존한 `renderer-under-test.js`가 모두 이 SHA와 일치했다. 생산 코드 수정은 하지 않았다. 이번 결과로 실제 캐릭터 움직임 전체 완료를 선언하지 않는다.

## 판정과 환경

원본 PNG를 같은 브라우저의 native Canvas `drawImage`로 한 번 그린 결과를 독립 기대값으로 삼았다. 정렬/단일 affine 메시의 내부 공유 경계에는 픽셀 차이가 없어야 한다. 원본 PNG와 디코드 후 RGBA를 구분했다. alpha0의 숨은 RGB 정규화나 PNG의 저알파 반올림을 원본 바이트 손상으로 판정하지 않았다.

| 실행 | 실제 로드 origin / SHA | 기본 fixture 17개 | 회전·기울기 8개 | 실제 캐릭터 기본 pose |
|---|---|---:|---:|---:|
| 설치된 Chrome **150.0.7871.47**, headless, Windows | `http://127.0.0.1:8874`, 지정 SHA 일치 | 2 pass / **15 fail** | **0 pass / 8 fail** | **2,502픽셀 불일치**, 최대 채널 차이49 |
| Aside 브라우저, UA Chrome/153.0.0.0 | 같은 origin·동일 스크립트/입력 | 17 pass | 8 pass | native와 RGBA 전체 일치 |

두 환경은 DPR1 / viewport1440×900 / Canvas sRGB RGBA8로 측정했다. Aside는 축약 UA이므로 정확한 빌드 번호를 단정하지 않는다. 환경별 결과 차이의 상세 원인은 미확정이다. **Aside의 통과로 설치된 Chrome의 실패를 상쇄하지 않는다.** 초기 정수 fixture 17 pass는 Aside에 한정된 관찰이다.

Chrome의 자체 제작 캐릭터 source PNG와 부위 PNG들의 native 기본 합성은 RGBA 전체 일치(차이0)했다. 독립 QA가 새로 그린 Chrome 기본 renderer PNG는 디자인 담당이 제공한 `poses/eyeOpen-1.png`와 RGBA 전체 일치(차이0)했다. 따라서 제공된 이음새를 독립 재현했다. 부모·얼굴을 제거한 실제 몸체 단독도 **1,934픽셀 불일치**다.

## 최소 재현과 실제 픽셀

QA 루트는 `D:/Pankeki/work/team-resume/motion-qa/renderer-pixels/`다. `minimal-repro.html`과 `minimum-reproduction.json`이 두 삼각형만의 최소 재현이다. 별도 앱/UI/문서 parser/GPU가 필요하지 않다.

1. 기존 Python으로 QA의 `serve_fixture.py --port 8874`를 실행한다. 최초 대상 SHA가 바뀌면 prepare는 거절한다. 이미 동결한 증거를 재현할 때는 QA 폴더를 기존 HTTP 서버로 제공하면 된다.
2. 설치된 Chrome에서 `http://127.0.0.1:8874/minimal-repro.html`을 연다.
3. 96×96 `inputs/half.png`를 opacity1로 그린다. 입력 RGBA는 `[240,80,40,128]`이고, `createGrid(96,96,{columns:2,rows:2})`의 두 삼각형은 대각선을 공유한다.
4. renderer 결과와 같은 PNG의 native 단일 draw를 비교한다. 기대값은 **같은 브라우저에서 디코드/합성한 값**이다.

| 사례 / 좌표 | 실제 RGBA | 기대 RGBA | 의미 |
|---|---|---|---|
| 반투명 두 삼각형 (12,12) | `[239,80,39,112]` | `[239,80,40,128]` | 공유 대각선 alpha16 감소 |
| 같은 그림 (12,20) | `[239,80,40,128]` | 동일 | 경계 밖 정상 |
| 불투명 두 삼각형 (12,12) | `[240,80,40,191]` | `[240,80,40,255]` | 불투명 소재도 경계 alpha64 감소 |
| 반투명4×4 + 배경 (12,12) | `[118,62,71,255]` | `[132,64,68,255]` | 배경 위 색/밝기 이음새 |
| 부모 .5 × 자식 .4 (12,12) | `[244,80,42,48]` | `[240,80,40,51]` | 수치 opacity .2는 맞지만 경계 합성 실패 |
| 실제 캐릭터 (408,247) | `[152,111,82,255]` | `[117,67,33,255]` | 눈에 보이는 밝은 선, 최대 차이49 |

최소 반투명 사례는 대각선96픽셀,4×4는288픽셀이 다르다. 회전·기울기 사례는 외곽3 source px를 제외하고 **내부 공유 경계를 포함**해 비교해도 8개 모두 실패한다. 분수 좌표/세로 경계의 실패를 외곽 antialias 차이로 숨기지 않았다. 실제 눈0/입1/호흡1 PNG도 보존했으며, 움직인 이미지를 원본과 같아야 한다고 비교하지 않았다.

원인 추정: 현재 renderer의 삼각형별 `context.clip()` → `drawImage()` 누적 경로(기준 파일287/293/295행)에서 공유 경계의 부분 coverage가 각각 source-over 합성되는 현상과 수치가 일치한다. 예를 들어 불투명 소재의 두 절반 coverage는 .75 alpha(191), 반투명 소재는 .4375(112)가 된다. 이는 조사 근거이며 QA가 수정 방식을 지정하거나 생산 코드를 고친 것은 아니다. 단순 clip 확장은 반투명 중첩을 만들 수 있으므로 통과 조건을 완화할 근거가 되지 않는다.

## 사전 검증과 마지막 유효 화면

Chrome와 Aside 모두 **잘못된 입력12개 + 마지막 보존 확인1개 =13/13 pass**다. 실제 Canvas의 모든 RGBA 바이트를 SHA256으로 비교했다. Chrome 마지막 유효 프레임과 모든 실패 후 프레임의 pixel SHA는 `02847569df3d7a711a8e9e1e2e545a47b112571d5530ff26cbefbe7392b14343`로 유지됐다.

- stale rig, source 교체, backgroundReady=false, material 교체, 두 binding 합산 뒤집힘,0.0001px² 미만 면적은 evaluate에서 사유를 만들고 draw에서 `blocked_pose`로 거절했다.
- 앞 draw가 유효하고 뒤 draw가 누락 decode/미디코드 이미지/축소 삼각형/범위 밖 opacity/잘못된 UV인 경우에도 전체 화면이 유지됐다. 배경 크기 불일치도 지우기 전에 거절했다.
- 부모 opacity의 수치 곱 .2, 숨긴 부모의 자식 제거, caller 상태 복원, filter/shadow/transform 오염 방지는 통과했다. **opacity 수치 통과와 공유 경계의 픽셀 실패는 별개**다.

여기서 입증한 것은 renderer의 사전 검증 오류 거절과 픽셀 보존이다. 앱 재생·출력 중단, 예기치 않은 브라우저 drawImage 장애 후 롤백까지 시험한 것은 아니다.

## 보존 증거

- `inputs.json`: 고정 원본 경로/PNG·RGBA SHA, 실제 캐릭터 project/source/디자인 제공 PNG SHA. 입력 PNG11개는 실행 전후 바이트 SHA가 유지됐다.
- `results/chrome-character--browser-report.json`, `chrome-character--character-report.json`, `chrome-character--launch.json`: 실제 origin/로드 SHA/브라우저 버전/입력 pose/전 픽셀 통계/오류와 전후 해시.
- `results/aside-character--browser-report.json`: 다른 환경의 통과 결과를 별도 보존. 초기 접두어 없는 결과는 탐색 기록이며 최종 Chrome 판정을 대체하지 않는다.
- `results/*--*.rgba`: 실제 `getImageData`의 row-major RGBA8 원시 바이트. 대응 `*.png`는 같은 Canvas의 PNG다. 기본 fixture는96×96, 실제 캐릭터는640×640이다.
- `results/chrome-shared-edge-diagnostic.png`: 실제/기대/차이 픽셀, 실제 캐릭터 확대 비교판. `chrome-character--browser-page.png`: 실제 브라우저 화면.
- `artifact-verification.json`: 양 환경의 PNG/RGBA **126쌍**을 SHA·크기·PNG decode ↔ getImageData 전체 일치로 독립 확인했다. 이는 증거 파일 무결성 검사이며 renderer126건 성공이라는 뜻이 아니다.
- `evidence-manifest.json`: QA 디렉터리 증거의 파일별 바이트 수/SHA. `run_chrome.cjs`, `pixel-tests.js`, `character-tests.js`, `serve_fixture.py`로 격리 재현한다. 새 패키지 설치0, 생성/Comfy/GPU 추론0, 전체 회귀0이다.

## 수정본의 통과 조건

총괄이 기술 담당 수정본 SHA를 수집한 뒤 **영향 픽셀 사례만** 재검증한다. 기준 실패 증거는 유지하고 새 run ID/로드 SHA로 결과를 저장한다.

1. 설치된 Chrome150에서 두 삼각형/4×4 메시의 불투명·반투명·alpha0/부드러운 경계, 배경 합성, 겹친 부위, 부모 .2 opacity가 같은 native 기대 픽셀과 일치해야 한다. 외곽을 제외한 회전·기울기 내부도 공유 대각선·세로 경계의 alpha 감소/증가가 없어야 한다.
2. 실제 캐릭터 기본 renderer는 native 기본 합성/source와 RGBA 전체 일치해야 한다(현재2,502 → **0**). 몸체 단독도1,934 → **0**이어야 한다. 특히 (408,247)은 `[117,67,33,255]`로 복구돼야 한다.
3. 실제 눈0/입1/호흡1에서 밝은/검은 메시 선, 중복 눈·입이 없어야 한다. 움직인 pose는 별도 정점/픽셀 근거로 검수한다. 기본 pose와 같다는 잘못된 기준을 쓰지 않는다.
4. 공유 경계를 숨기려고 소재 alpha/전역 opacity를 올리거나 이웃 삼각형의 반투명을 중복 합성하면 실패다. 수정 경로가 검증/그리기 원자성에 영향을 주면 위12개 오류 보존 사례도 좁게 재확인한다.

현재 T4 픽셀 품질은 실패 상태다. UI·사용자 제공 PNG 가져오기·저장/재개·48프레임 ZIP·성능 수용은 이번 범위 밖이며 미검증이다. 백업 디렉터리는 접근/변경하지 않았다.
