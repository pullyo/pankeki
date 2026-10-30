# 움직임 UI 계약 v1 — T5/T8

2026-10-20 KST. 승인된 `2026-10-20-motion-first-implementation.md`와 design/spec, character-document-contract를 따른다. **이 이름으로 markup을 구현하며 프론트가 바로 연결한다.** 기존 studio 화면값 `parts|motion|export`, 기존 v1 ID·경로를 유지한다. 새 컨트롤은 기본 disabled이고 controller가 실제 문서/리그/연산 상태에 따라 활성화한다. 단순 화면 표시를 준비 완료로 취급하지 않는다.

## 소유와 mount

- 디자인: template/CSS/build, `web/assets/motion-demo/`, 이 계약과 디자인 인계. 기능 JS는 수정하지 않는다.
- 프론트: `PankekiMotion.mount(document,{editor,renderer,exporter,decodeAsset,onError})` 및 기존 app/studio 연결. 모든 부위·예제·사용자 PNG·v2는 같은 editor/parse/loadDocument 경로다.
- `motionEditor`는 parts/motion/export를 감싼 표시 wrapper. `data-motion-state="blocked|loading|ready|playing|exporting|error"`를 controller가 갱신한다. 기존 studio.js가 `[data-studio-page]`와 탐색을 소유한다.
- 버튼은 아래 ID와 `data-motion-action`을 함께 제공한다. 복수 위치의 동일 action은 data 속성을 사용하고 ID는 한 번만 둔다. `[data-motion-summary="name|parts|readiness|history|selection|export"]`는 반복 가능한 실제 요약 슬롯이다. `motionStatus` role=status, `motionError` role=alert(hidden)는 상태/실패 사유이며 per-frame live 알림을 만들지 않는다.
- 스크립트 순서: profiles → character-document → character-renderer → character-export → character-motion → app → studio. 모듈 로드만으로 mount하지 않고 app 초기화 후 프론트가 명시 mount한다.
- 자체 제작 예제는 `motionDemoProject`의 `<script type="application/json">{{MOTION_DEMO_JSON}}</script>`로 내장한다. 순수 v2 JSON이다. `load-demo`는 parseDocument 검증 후 사용자 v2와 같은 loadDocument를 사용한다. 경로/원격 fetch/미리 만든 영상/예제만의 별도 렌더 경로를 쓰지 않는다.

## 문서/공통 작업

| ID | type / action | 의미 |
|---|---|---|
| motionLoadDemo | button / load-demo | 자체 제작 팬케이크 v2 가져오기. 미저장 작업 확인은 프론트가 소유 |
| motionProjectUpload | file JSON / — | v1/v2 가져오기. `multiple` 아님, accept `.json,application/json` |
| motionPickProject | button / pick-project | 위 file picker 열기 |
| motionSaveProject | button / save-project | pause(commit) 후 v2 저장. v1 축소 저장 금지 |
| motionUndo / motionRedo | button / undo, redo | 한 drag/조절=한 명령. 런타임 이력만, 재개 시 과거 undo 없음 안내 |
| motionStatus / motionError | status / alert | 준비·작업·오류 사유. 마지막 유효 화면 유지 |
| motionHistoryStatus | text | 현재 canUndo/canRedo 또는 재개 이력 안내 |

## 부위·원본·배경

| ID | type / action | 의미 |
|---|---|---|
| motionSourceSelect | select | 실제 기준 후보 ID 옵션. v1 이미지 하나에 자동 분리 완료 표시 금지 |
| motionUseSource | button / use-source | 선택 후보를 기준으로 준비. 다른 source에 기존 리그 자동 이식 금지 |
| motionPartUpload | file PNG multiple | 준비한 RGBA 부위. `pick-parts`로 선택, 실제 디코드·해시 확인 |
| motionPickParts | button / pick-parts | 부위 file picker 열기 |
| motionBackgroundUpload | file PNG | 깨끗한 배경. `pick-background`로 선택, 캔버스 크기 대조 |
| motionPickBackground | button / pick-background | 배경 file picker 열기 |
| motionTransparentScene | checkbox | 배경 없이 모두 분리한 RGBA 장면임. backgroundAssetId=null 허용 조건 |
| motionBackgroundConfirmed | checkbox | 깨끗한 배경/분리된 투명 장면을 미리보기로 **사람이 확인** |
| motionConfirmBackground | button / confirm-background | setBackground{assetId,confirmed}를 한 명령으로 commit. 체크만으로 자동 복원 성공을 추정하지 않음 |
| motionBackgroundStatus | status | 배경 크기·선택·확인·차단 사유 |
| motionPartList | div role=listbox | 실제 parts만. 옵션은 controller가 `data-motion-part-id`, role=option, aria-selected로 생성. 미등록 가짜 눈/입 목록 없음 |
| motionPartName / motionPartParent / motionPartOrder | text(max80) / select / number | 실제 이름·부모·order. parent 옵션 첫 항목 value=""은 루트 |
| motionPartX / motionPartY | number step=.1 | 소재 local→parent 기준 배치 px |
| motionPartScaleX / motionPartScaleY | number step=.01 | 배치 scale. 실제 문서 검증은 controller/editor가 수행 |
| motionPartVisible / motionPartOpacity | checkbox / number0..1(.01) | 표시·불투명도 |
| motionLockMaterial / motionLockTransform | checkbox | 소재·직접 변형 잠금 |
| motionApplyPart | button / apply-part | 위 선택 부위 속성을 setPart 한 명령으로 적용 |
| motionRemovePart | button / remove-part | 자식/참조가 있으면 기존 문서 명령의 거절 사유 표시 |

## 실제 캔버스·메시·key 등록

- `motionPartsCanvas`는 parts 준비/편집의 실제 Canvas, `motionCanvas`는 motion 실제 미리보기 Canvas다. 둘 다 같은 pose/draw 경로다. wrapper `data-motion-canvas="parts|preview"`는 controller가 활성 화면을 고르는 힌트다. 비활성 화면을 계속 렌더할 필요는 없다. 초기 bitmap640²이며 실제 document.canvas 크기로 controller가 조정한다.
- `motionMeshCanvas`는 `motionPartsCanvas`와 같은 표시/bitmap 사각형의 편집 overlay. pointer 좌표를 문서/소재 로컬로 변환하는 책임은 controller다. 실제 이미지 대체용 CSS/영상이 아니다. 조절점은 overlay에서 그리고 아래 숫자 선택으로도 편집한다.
- `motionPartsEmpty`, `motionPreviewEmpty`는 초기 안내. 실제 장면이 렌더되면 hidden. `motionCanvasFrame`/`motionPreviewFrame`은 비율을 유지하는 stage다. CSS만으로 원본/소재 픽셀을 바꾸지 않는다.

| ID | type / action | 의미 |
|---|---|---|
| motionGridColumns / motionGridRows | number2..16 default4 | 정점 개수. 곱≤256, 삼각형≤512를 검증 |
| motionCreateGrid | button / create-grid | 선택 부위 실제 소재 크기로 격자 생성. 미준비/잠금/stale 차단 |
| motionPointSelect | select | 실제 정점 index, controller가 옵션 생성 |
| motionPointX / motionPointY | number step=.1 | 선택 정점의 소재 로컬 좌표 |
| motionApplyPoint | button / apply-point | 숫자 조절. 드래그 preview와 같은 검증, 최종 저장 단위는 controller |
| motionKeyParameter | select eyeOpen/mouthOpen/breath | 등록할 binding |
| motionKeyAt | select 0/.5/1 | 최소/중간/최대 key. 기본값 eye1·mouth0·breath0의 delta=0, 중복 endpoint key 금지 |
| motionResetKeyPreview | button / reset-key-preview | 저장 전 편집 중 key 정점을 base로 복귀. 문서의 다른 key를 조용히 삭제하지 않음 |
| motionSaveKey | button / save-key | 현재 편집 정점을 같은 topology/UV의 displacement key로 검증·등록 |
| motionMeshStatus | status | 선택 정점/편집 key/면적·뒤집힘 거절 사유 |

모바일은 실제 보기와 간단 파라미터·재생·저장 사용을 우선한다. 정밀 메시/기준 형태 도구는 `<details class="motion-precision-tools">`에 두고 데스크톱 권장을 표시한다. 사용자 PNG 가져오기 경로는 모바일에서도 접근 가능하다.

## 프리셋·3개 파라미터

| parameter | 기존 range ID | number ID | 값 |
|---|---|---|---|
| eyeOpen | warmEyeOpen | motionEyeOpenNumber | 0..1 step .01, 기본1 |
| mouthOpen | warmMouthOpen | motionMouthOpenNumber | 0..1 step .01, 기본0 |
| breath | warmBreathing | motionBreathNumber | 0..1 step .01, 기본0 |

각 입력은 `data-motion-param="eyeOpen|mouthOpen|breath"`, `data-motion-input-kind="range|number"`. input은 로컬 미리보기, change/pointerup은 같은 제스처당 한 setParameters 명령. 프론트가 입력을 동기화하고 재생 중 조절이면 pause 후 적용한다. 준비된 binding만 enable한다. `motionParameterStatus`에 나머지 차단 사유를 표시한다.

- `warmExpressionPreset`: 실제 preset ID select. `motionPresetName` max80, `motionSavePreset` action save-preset, `motionApplyPreset` action apply-preset. name은 새 preset.id의 표시 초안이며 controller가 고유 ID를 정한다. rigHashes 불일치면 적용 불가.

## 곡선·재생·정지·시간 이동

- `motionMotionSelect`는 실제 motion ID select, `motionCurveName` max80, `motionCurveParameter`는 parameter ID select다.
- `motionCurveKeys`는 `<tbody>`. 동적 행은 `data-motion-key-index="n"`, 숫자 입력은 `data-motion-key-field="time|value"`. time 0..2 step .01, value 0..1 step .01, 값마다 읽을 수 있는 aria-label을 부여한다. 삭제 버튼은 action `remove-curve-key` + 같은 index. 초기 가짜 key 행은 없다.
- `motionAddCurveKey` action add-curve-key, `motionSaveCurve` action save-curve. 0/2초 포함·증가순·≤32키·루프 양끝값 일치를 검증한다. 실패 시 이전 motion 유지. 저장된 곡선은 실제 motion 저장 경로를 사용한다.
- `motionPlay` action play, `motionPause` action pause, `motionSeek` range0..2 step .001, `motionTime` output(aria-live=off), `motionLoop` checkbox 기본checked. pause는 보이는 값 commit1회, seek는 런타임 pose이며 매 프레임 undo/revision 증가 금지.
- `motionPlaybackStatus` role=status는 준비/재생/정지/오류만 알리고 초당 수십 번 live 알림을 하지 않는다. 화면 전환/숨김/문서 변경 시 취소·중단은 controller가 소유한다.

## 정지·저장·48프레임 출력

- `motionExportPng` action export-png, `motionExportFrames` action export-frames, `motionCancelExport` action cancel-export.
- `motionExportProgress` progress(max48,value0), `motionExportStatus` role=status. 대기/계산중 n/48/취소/실패/완료를 구별한다. 유효한 48 PNG+manifest의 ZIP이 반환된 뒤에만 실제 다운로드한다. 부분 Blob을 성공으로 제공하지 않는다.
- 위 controls는 기존 export 페이지의 `motion-export-panel`에 둔다. v1의 기존 프로젝트/보드/PNG와 v2 정지/ZIP/저장은 서로 다른 실제 버튼/설명으로 구분한다. 공통 toolbar의 v2 save-project는 기존 saveProject를 눌러 v1로 내리는 action이 아니다.
- parts/motion/export에서는 혼동을 막으려고 상단 header의 v1 이름 입력·저장/보드 버튼을 CSS로 숨긴다(ID/핸들러 보존). v2 이름/저장은 motion toolbar를 사용한다. 기존 v1 파일 저장/보드는 export의 ‘기존 이미지 프로젝트 · v1’ 구역에서 명시적으로 접근한다.
- 색조절(`warmPartColor/Hue/Saturation/Strength`)·Codex 대화·외형조합·표정 시트 등 이번 범위 밖 controls는 disabled를 유지한다. Codex 안내는 ‘Codex 대화 미연결’로 통일한다.

## 예제 자산·대기 경계

직접 제작한 팬케이크 캐릭터를 640² 문서로 준비한다. 몸·눈·입은 RGBA PNG, 깨끗한 배경은 별도 PNG, source.png는 기본 pose의 실제 합성이다. 눈의 감김은 유효 높이>0인 key, 입은 내부 그림이 있는 소재와 key, 호흡은 제한된 정점 변형이다. 예제 project.json은 실제 파일 바이트 hash와 tuple rigHash를 사용한다. SVG 제작 원본·렌더 스크립트·provenance를 함께 보관한다. 신규 생성 모델·다운로드·사각형 fixture·미리 만든 재생 영상은 없다.

모듈이 아직 없을 때는 준비 중 문구와 disabled를 유지한다. markup/예제 준비만으로 실제 변형·저장·48출력 완료를 표시하지 않는다. 모듈 전달 후 최종 빌드와 T9 독립 브라우저 검증을 별도 완료 조건으로 둔다.
