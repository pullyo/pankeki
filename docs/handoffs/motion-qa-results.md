# 움직임 T9 독립 QA — 오늘 검수 결과

2026-10-20 KST. **오늘 실행한 준비·편집·저장/재개·정지 PNG·48 ZIP 경로는 통과했다. 전체 T9 수용 완료는 아니다.** 사용자 제공 원본은 분리 소재/크기 요건을 충족하지 않아 정상 사용자 소재 준비 항목은 미검증으로 남긴다. 아래 측정은 실제 로컬 정적 미리보기이며 SDK·이미지 생성 성공 증거가 아니다.

## 실행 경계

최신 검수 origin은 **`http://127.0.0.1:8197/`**, 실제 응답 HTML과 동결 파일의 SHA256은 **`435515fb7e4b436f1496622eac99f599bdd9bc04b3b17f47f1580aee9b4adc32`**다. 브라우저는 설치된 **Chrome150.0.7871.47, headless, Windows,1440×1040,DPR1**이다. 모델/health GET의503은 이 정적 preview의 격리 상태이며 생성·변경 API 요청이나 모델/GPU 추론은 실행하지 않았다.

| 소비 파일 | SHA256 |
|---|---|
| character-document.js | `07c101beacf5842c11350f7276610bd6a37a7af5a314717c9a1d7b4c7ceec6ec` |
| character-motion.js | `269bc88e4872d4e42846574af26d772eebae612530d068d72705ef14e6041062` |
| character-renderer.js | `70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae` |
| character-export.js | `62bcc6b74aee1d5769f51dca0f59429f930904b288e9fbd663ea16f6767cd9ce` |
| app.js | `b0c69ae04f02bd9f2503c19940e39d08997da77033339d7b7aa9a52a4e6a0e57` |
| studio.js | `3c64df5b59b2617552fd946dc34821b8f8505cf4fb89c6117fa3e646064de620` |

QA 산출물 루트는 `D:/Pankeki/work/team-resume/motion-qa/ui-acceptance/`다. 해당 동결 preview의 위6파일은 최종 확인 당시 D: 생산 소스와 동일했다. QA는 생산 코드·빌드·백업·모델 비교 파일을 수정하지 않았다. 기존 RGBA001 픽셀 수용75쌍·영상·완료 suite는 반복하지 않았다.

## 실제 통과한 항목

| 항목 | 실제 증거와 판정 |
|---|---|
| INIT001 / PLAY001 후속 | 빈 시작은 준비 전·오류 없음·재생 비활성. 예제와 가져온 saved-cycle 모두 play→pause→play→pause에서 실제 선택값이 유지되고 stale 오류가 없다. `interaction-performance-qa.json`의 해당17개 검사. |
| 파라미터 UI | 눈/입/호흡을 각각0/.5/1로 입력한9개 실제 PNG의 픽셀·정점 hash가 파라미터별3종으로 달라졌다. source PNG bytes·UV·삼각형 연결은 불변이다. `ui-eyeOpen-*`, `ui-mouthOpen-*`, `ui-breath-*` 참조. |
| 연속 재생 / seek / pause | 실제 눈 ROI 픽셀과 눈·호흡 값이 시간에 따라 바뀐다. 프레임마다 revision이 쌓이지 않고 pause는 한 commit 이내이며 정지 픽셀/값이 유지된다. seek=.95에서 눈0/호흡.95를 실제 렌더했다. 화면 이동은 RAF를 중단했다. |
| STATE001 | 최신 controller/document/renderer를 사용해 이전 임시 검증을 지연하고 숨김 commit을 enqueue한 뒤 새 문서를 로드했다. 대기열을 끝까지 비우면 옛 명령은 false, 새 eyeOpen1/revision0/dirty=false/canUndo=false를 보존한다. `state001-independent.json`. DOM/디코더/지연 지점은 제어 대역이며 실제 픽셀 증거와 구분한다. |
| v2 저장 / undo / 새 작업 | 상단 저장과 움직임 저장 모두 같은 실제 v2를 다운로드했다. 자산·리그·동작이 남고 입력 한 번의 undo/redo가 원래 pose를 복구한다. 새 작업 취소는 현재 v2 보존, 확인은 이전 움직임 중단/초기화다. `save-export-qa.json`15개 검사. |
| 재생 중 저장 | 실제 저장 버튼 click 시 보이던 breath=`0.26679999999850984`가 저장된 v2와 같다. revision0→1 한 번, playing=false/dirty=false로 멈췄다. `save-during-play-qa.json`, `saved-while-playing.v2.json`, `visible-at-save-click.png`. |
| 재가져오기 / 자동 복원 | 상단 파일 가져오기 후 정지 RGBA 전체 hash가 저장 직전과 같고 undo/redo는 비어 있다. 별도 QA 프로필의 Chrome 프로세스를 닫고 다시 실행한 실제 IndexedDB 자동 복원도 pose·값이 같았다. 사용자 실사용 프로필은 쓰지 않았다. |
| 실제 PNG 최초 준비 / 편집 | 자체 제작 실제 body/eyes/mouth PNG3개를 부위0인 문서에서 파일 선택으로 가져왔다. 정상+깨진 PNG batch는 전체 보존, 정상3개는1 revision으로 등록했다. 배경 준비 확인→배치/부모→각4×4 grid→key 등록 순서로 완성했다. 최종 `placement-followup-qa.json`6/6에서 몸(100,125),눈(부모 body 상대140,194),입(상대186,244/높이8)과 native 합성의 RGBA 차이0을 확인했다. |
| key / 무효 기하 | 실제 좌표 입력과 기준 key 등록이 새 변형을 만들며 기본 delta0·UV/연결을 보존했다. 뒤집힌 정점 입력은 문서와 마지막 Canvas를 보존했다. `parts-preparation-qa.json`의 유효 key/무효 기하 검사와 최종 배치 후 재등록 증거를 함께 따른다. |
| 정지 PNG | 실제 UI 다운로드 PNG가 현재 pose와 동일하다. 기본 배경 예제 및 최종 조립 투명 장면의 native PNG 기준 RGBA 차이0이다. |
| 실제48 ZIP | ZIP을 Python zipfile/Pillow로 독립 판독했다. CRC, STORE,0000..0047 PNG48개+manifest 총49개,640² RGBA, duration2/fps24, `t=k/24`, ready rigHash가 맞다. 기본 예제와 최종 조립 투명 장면 각각 **48/48프레임**이 해당 시각의 native PNG 렌더 기준과 RGBA 전체 일치했다. 49번째 프레임은 없다. |
| 투명도 | 최종 조립 PNG와 ZIP48개 모두 alpha0 외곽·반투명 가장자리·불투명 내부를 보존했다. 원본 자산의 alpha/byte SHA도 유지했다. |
| 취소 / 출력 실패 / 상한 | 실제 UI 출력 취소 뒤 완성 파일이 내려오지 않았다. 실제 Canvas의 세 번째 인코더 callback을 null로 만드는 오류 주입도 문서 보존/다운로드0이다. 별도 `Blob.size=128MiB+1` 경계 주입은 arrayBuffer 읽기 전에 거절했다. 실제128MiB 파일 할당/메모리 최대 부하를 실행한 것은 아니다. |

## 성능 실측

Intel Core Ultra5 225F / NVIDIA RTX5060, 드라이버32.0.15.9579에서 측정했다. 실제 Canvas 렌더가 도는 동안 pixel readback을 넣지 않고 RAF 시각을 약3.2초 수집했다. **headless 브라우저의 렌더 진행 cadence이며 물리 디스플레이 FPS 보장은 아니다.** 입력은 실제 숫자 UI input event 시작부터 다음 RAF의 갱신값까지다.

| 장면 / 표본 | 측정값 |
|---|---|
| 제공 예제640²,3부위,부위당4×4 grid | RAF767표본,239.3fps,frame p95=4.5ms. 숫자 입력8표본 최대3.5ms. |
| 자체 준비 PNG640²,3부위,총48정점/54삼각형,국소 비선형 key | RAF105표본,**32.5fps**,frame p95=38.9ms. 별도 실제 입력3표본28.0/32.1/31.3ms. 이 측정은 최초 좌표0 스트레스 문서에 한정하며 최종 배치 문서의 재측정으로 확대하지 않는다. |

측정한 두 조건의 평균30fps/입력100ms 목표는 통과했다. 비선형 조건의 여유는 작고 p95가 평균 프레임 목표보다 길다.1024²/16부위/최대 메시 부하와 사용자 분리 소재의 성능은 측정하지 않았다.

## 사용자 제공 PNG와 미검증

사용자가 지정한 `C:/Users/Administrator/Downloads/character-turnaround-original-preserved-6x-8688x6516-300ppi.png`는 **45,545,358bytes /8688×6516/56,611,008pixels**다. SHA256은 실행 전후 **`0f5a4657dcfd43448016d738ba72c3359fdad8e273973830164f0e136f7b777a`**로 동일하다. 원본은 수정·축소·자동 분리하지 않았다.

실제 부위 파일 입력에서는 크기 guard로 거절되고 기존 프로젝트가 유지됐다. 이 단일 미분리 고해상도 PNG를 정상 다중 부위 준비 성공으로 세지 않는다. 별도 사용자 준비 PNG세트가 없으므로 **사용자 고유 캐릭터의 분리 부위 준비→메시/key→재생→저장/출력 전체 흐름은 미검증**이다. 자체 제작 예제의 부위 준비와 구분한다.

- 실제 OS/브라우저 탭 숨김은 headless 다중 페이지에서 `document.hidden=false`로 남아 확인하지 못했다. visibilitychange 제어 이벤트와 화면 전환 중단만 통과했다.
- 모든64MiB JSON/64자산/16MP decode/128MiB 누적 RGBA/16부위/256정점/512삼각형/32key/undo50·patch32MiB의 전체 한도 매트릭스는 이번 UI 검수에서 다시 실행하지 않았다. 담당 수치 증거와 이번 실제 대형 PNG/출력128MiB 경계 검사를 구분한다.
- 모든 source/material 교체·합성 뒤집힘의 UI 재생/출력 중단 조합, 늦은 디코드/출력과 문서 교체의 전체 조합은 미실행이다. STATE001의 특정 대기열 경계와 실제 취소 검사를 전체 race 수용으로 확대하지 않는다.
- SDK/실제 backend 이미지 생성·모델/GPU 추론, 최대 부하/물리 화면 FPS는 미실행이다. 따라서 전체 제품/전체 T9 완료로 표시하지 않는다.

## 보존한 실패·관찰과 QA 보정

1. 구8196 build `6d3170...`의 PLAY001/INIT001 및 초기 검사 실패는 구버전 증거로 보존했다. 최신8197의 반복 play/pause·import/empty 검사가 그 변경 영향 수용이다. 첫 동영상은 디자인/총괄이 이미 보존한 것을 재사용하며 새 영상을 만들지 않았다.
2. `frame-oracle-readback-initial.json`의 불일치는 반복 getImageData/`willReadFrequently` 조건이 렌더 경로를 바꿀 때 재현됐다. `frame-oracle-probe.json`에서 같은 실제 ZIP3프레임은 fresh/default 또는 native encode 경로와0픽셀 차이, read-frequently 경로와는 차이를 보였다. 기준을 느슨하게 하지 않고 **readback 전 native PNG를 인코딩한 뒤 양쪽을 같은 조건으로 디코드**하여 정확한 RGBA0 기준을 유지했다. 최종 결과는 `export-frame-pixels-native.json`, `assembled-export-frame-pixels.json`이다. 실제 다운로드는 이 원인 조사에서 반복하지 않았다.
3. 첫 PNG 준비 시나리오는 배경 확인 전 이동을 시도해 앱의 정상 guard에 막혔는데 비동기 대기 조건이 이를 놓쳤다. 원점 배치인 `actual-prepared-transparent-*`는 key/알파/출력/성능 스트레스 문서로만 보존한다. **최종 배치 수용 및 인계 파일은 아래 `assembled-*`다.** 확인 순서를 고치고 문서의 실제 transform/parent를 직접 재확인하여 native 전체 일치까지 판정했다. 생산 코드 수정은 없다.
4. `save-during-play-timeout.json`에는 새 세션 play 대기의 원인 미확정 timeout을 보존했다. 짧은 상태/RAF 최소 재현은 정상 선택과 연속 재생을 보였고, 상태를 직접 수집한 후속 저장 경계도 통과했다. 이 한 관찰의 상세 원인을 단정하거나 새 제품 결함/전체 안정성 입증으로 처리하지 않는다.

## 직접 확인할 최종 파일

모두 `D:/Pankeki/work/team-resume/motion-qa/ui-acceptance/` 아래다.

- `assembled-prepared-motion.v2.json`: 실제 파일 선택/배치/부모/grid/key/curve를 거친 최종 편집 프로젝트.
- `assembled-prepared-pose.png`: 위 프로젝트의 현재 투명 pose PNG.
- `assembled-prepared-motion-48.zip`: 위 프로젝트의 실제 UI 출력. SHA256 `4fc4dbcdc0d10305e2333d9db36a51bdf1debc4c4580388189f9b922685152ba`.
- `saved-top.v2.json`, `saved-while-playing.v2.json`, `actual-ui-pose.png`, `actual-ui-48.zip`: 기본 예제의 실제 저장·출력 파일.
- `download-independent-verification.json`, `assembled-zip-verification.json`, `assembled-export-frame-pixels.json`: 독립 ZIP/PNG/프레임 시각·RGBA 판정.
- `today-summary.json`, `ui-evidence-manifest.json`: 통과/관찰/미실행·소스와 실제 산출물별 SHA. 브라우저 프로필/캐시는 증거 목록에서 제외한다.

현재 검수한 최신 경로의 확인된 생산 코드 차단 결함은 없다. 미검증과 원인 미확정 관찰을 남긴 부분 수용이며, 별도 사용자 분리 소재와 남은 전체 T9 보완은 후속 범위다.
