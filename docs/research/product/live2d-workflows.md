# Live2D 편집 흐름에서 가져올 Pankeki 아이디어

2026년 10월 20일 KST 확인 · 사용자·경쟁제품 리서치 1차 · 총괄 검토 대기

## 확인한 사실

총괄의 설치 확인값은 **Live2D Cubism Editor 5.3.04**다. 공식 기록에는 5.3.04가 2026-09-03 정식, 5.3.05 beta1이 2026-10-13으로 표시된다. 설치 앱 직접 조작·업데이트·사용자 테스트는 수행하지 않았다. [공식 출시 기록](https://docs.live2d.com/en/cubism-editor-manual/new-feature-introduction-title/)

| 공식 편집 흐름 | 확인한 근거 |
| --- | --- |
| 파츠 선택 | Parts palette는 가져온 PSD의 눈·입·앞머리 등을 분류하고 검색·선택·표시·잠금과 View 선택 연동을 제공한다. [Parts palette](https://docs.live2d.com/en/cubism-editor-manual/partspalatte/) |
| 변형 계층 | Deformer에서 부모·자식을 관리한다. 부모 변형은 자식에 전파되고 자식 변형은 부모를 바꾸지 않는다. [부모 자식 구조](https://docs.live2d.com/en/cubism-editor-manual/system-of-parent-child-relation/) |
| 파라미터와 키폼 | 오브젝트와 파라미터를 선택해 2점/3점 키를 추가하고 변형 상태를 등록한다. 등록한 키 사이 형상은 보간된다. 관련 파라미터 필터·기본값 복귀·기본 키폼 잠금도 있다. [키 추가](https://docs.live2d.com/en/cubism-editor-manual/edit-parameters/), [Parameters](https://docs.live2d.com/en/cubism-editor-manual/parameter/), [Parameter palette](https://docs.live2d.com/en/cubism-editor-manual/palametorpalatte/) |
| 표정과 물리 확인 | Physics Settings의 Physics/Playlist 탭에서 모델과 파라미터 반영을 확인한다. 표정·몸 동작 장면을 결합해 재생할 수 있다. 별도 Viewer for OW는 표정 파일의 fade·파라미터를 확인하고 내보낸다. [Physics Settings](https://docs.live2d.com/en/cubism-editor-manual/switch-viewer-setting/), [Playlist](https://docs.live2d.com/en/cubism-editor-manual/about-playlists/), [표정 설정](https://docs.live2d.com/en/cubism-editor-manual/setting-and-exporting-facial-expressions/) |

Pankeki 소스의 후보는 이미지·생성 당시 brief/request·parentId를 보관한다. parentId는 이미지 이력이며 Live2D처럼 변형이 전파되는 계층은 아니다. **프로젝트는 후보·설정·선택 기록을 저장하지만 편집 마스크는 저장하지 않는다.** 불러오기 뒤 재칠하기를 안내한다. 새 필드는 현재 v1 파서가 거부하므로 마스크/검수 저장 확장은 공통 계약 조정이 필요하다. 근거는 `D:/Pankeki/web/src/app.js`의 `commitSource`, `editCandidate`, `importProject`와 `web/src/profiles.js`의 `candidate`, `project`, `validateRequest`다.

## 제안 두 가지

### 1 원본과 수정 부위를 함께 보여 주기

**초기안.** 기존 후보를 원본으로 고정하고 사용자가 마스크를 칠한다. 원본 후보 이름·썸네일, `양손 장갑을 청록으로` 같은 목표, 칠한 영역을 함께 표시한다. 한 번에 하나의 목표로 시작하며 자동 파츠 분리를 전제로 하지 않는다. 목표는 기존 메모로 남길 수 있지만 저장 후에는 마스크 재칠하기가 필요하다.

**후속안.** 이름 있는 마스크 저장/재선택은 저장 계약 확장으로 검토할 수 있다. PSD 파츠·ArtMesh·독립 변형은 파츠 분리·메시·리깅이 필요한 별도 범위다.

**수용 기준.** 화면 원본과 실제 제출 원본/자식 parentId가 일치한다. 목표 선택만으로 생성 요청은 0회다. 원본 교체 때 마스크 초기화를 알리고, 복원되지 않는 마스크가 저장됐다고 표시하지 않는다.

### 2 기준 후보를 유지하며 결과를 확인한 뒤 전달하기

**초기안.** 부모와 자식 두 후보를 기존 비교로 보며, 사람이 최대 3개 요구를 미확인/충족/미충족으로 판단한다. 기준 후보와 작성 중 입력을 보존하고, 보드 메모에 선택 이유·미해결 항목을 남긴다. 새 수정본은 재검수한다. 이미지 생성 완료·마스크 밖 보존·시각적 요구 충족을 구분한다.

**후속안.** 실제 눈·입·각도의 연속 파라미터, 키폼 보간, 머리카락 물리·표정 playlist는 리깅된 모델과 재생 환경이 필요하다. 정지 후보 전환을 연속 제어나 물리 미리보기라고 부르지 않는다.

**수용 기준.** 비교 조작으로 원본 이미지·후보 request·현재 brief가 변하지 않는다. 미확인 요구는 자동 충족되지 않는다. PNG 보드와 편집 가능한 프로젝트의 저장 범위를 구분한다. 후보별 검수 저장은 기존 기획안과 같은 계약으로 총괄이 조정한다.

## 미확인 항목과 인계

위 두 안이 실제로 원본 오선택·완료 오판·작업 시간을 줄이는지는 미확인이다. 핵심 가설은 원본·부위·미충족 요구를 함께 보이면 다음 수정 판단이 정확해진다는 것이다. 인터뷰·사용자 테스트·리깅 실현 가능성·구현 비용은 검증하지 않았다. 모든 외부 URL 확인일은 2026년 10월 20일 KST다.

추가 전수조사와 구현은 중단했다. 교차 제품 아이디어 종합과 우선순위는 총괄이 맡는다. 기존 비교 자료는 [사용자 작업과 경쟁제품 흐름](user-competitor-research.ko.md), 근거 목록은 [research-evidence.json](research-evidence.json)에 보존했다.
