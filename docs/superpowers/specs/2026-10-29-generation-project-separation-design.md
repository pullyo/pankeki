# 이미지 생성과 프로젝트 분리

## 요청과 결정

사용자 요청은 “이미지 생성과 프로젝트 생성을 따로 두는 식”으로 분리하는 것이다.
사용자가 기능 분리를 요청했고, 동일 IndexedDB의 optional `kind` 사용은 총괄의 기술 판단이다.
기존 직원 구현·독립 QA·총괄 native 검토 방식을 유지한다. 프로젝트별 다중 채팅은 추가하지 않는다.
최신 전용 프로젝트 화면의 배치·검색·페이지 전환과 기존 홈 오른쪽 목록은 보존한다.

## 저장 계약

- catalog 레코드에 optional `kind: 'project' | 'generation'`만 추가한다. 누락은 `project`다.
- 기존 9/14 프로젝트의 row `id/raw/createdAt/updatedAt/favorite/recovered`를 변환하거나 일괄 migration하지 않는다.
- `kind`는 catalog metadata이며 v1 JSON·후보·이미지 bytes·parent·derivation/annotations/execution을 바꾸지 않는다.
- `getState().items`는 project만 반환하고 `activeKind`는 `generation | project`다. 미연결 빈 작업도 generation이다.
- 기존 `activeId`는 현재 연결된 row ID다. generation row의 ID도 유지하되 프로젝트 목록에는 표시하지 않는다.
- 일반 생성 원문도 같은 저장소에 durable하게 보존한다. 단일 legacy `current` 저장만으로 대체하지 않는다.
- legacy `current` 자동저장·자동복구는 유지하고, catalog와 두 저장소 사이의 부분 완료도 원문을 보존한다.

## 작업과 전환

- `openGeneration(): Promise<boolean>`은 현재 general이면 reset/load 없이 초안·selection·이미지를 유지한다.
- project에서 호출하면 현재 작업 저장을 기다린 뒤 마지막 general을 복원하고, 없으면 빈 general을 연다.
- general 복원도 기존 busy/IME/identity·확인·실제 이미지 decode·저장 실패 guard를 거친다.
- `saveAsProject(): Promise<boolean>`은 general을 별도 project snapshot으로 복사하고 새 project에 bind한다.
- 원 general row/raw는 남긴다. 빈 general은 거절하고, 이미 project이면 새 항목을 만들지 않는다.
- `saveCurrent()`·자동저장·파일 저장·`saveBeforeTransition`·recovery 재시도는 현재 종류를 유지한다.
- 명시적 새 프로젝트와 v1 프로젝트 import만 project를 생성한다. 일반 파일 export는 승격하지 않는다.
- init/restart에서 동일 raw가 두 종류에 있어도 persisted active ID와 종류를 우선해 재연결한다.
- 복원 중 새 입력·다른 문서가 생기면 기존 저장 원문과 새 화면을 모두 보존하고 잘못 bind하지 않는다.
- 같은 identity의 저장 실패는 대상 ID/종류로 재시도한다. identity를 잃었으면 대상 ID를 끊고 새 general로 저장하며, 실패 뒤 늦은 교체도 runtime 소유권을 다시 확인한다.
- 기존 draft Map·선택 범위 복원과 host 동작을 재사용한다. 새 채팅 저장 포맷은 만들지 않는다.

## UI 계약

- 사이드바 이미지 생성은 `openGeneration()` 성공 후 일반 생성 화면으로 간다.
- 프로젝트 카드 열기는 해당 프로젝트를 열고 같은 editor를 사용한다. 내부 route 이동으로 general을 다시 열지 않는다.
- 현재 문맥은 일반 이미지 생성 또는 실제 프로젝트 이름으로 구분하고 명시적 “프로젝트로 저장”을 제공한다.
- 일반 생성 후보 기록은 기존 후보/이미지 표시로 이어 보며 project 카드에는 섞지 않는다.
- 홈 composer와 템플릿은 guarded 일반 생성 진입을 거친다. 사용자가 입력한 text/selection을 유지한 뒤 기존 submit을 한 번만 실행한다.
- 프로젝트 편집기 내부 대화는 그 프로젝트에 남는다. 파일 export는 항상 종류를 유지하고 “프로젝트로 저장”만 copy 등록한다.

## 범위와 수용

core 담당은 `web/src/project-library.js`, UI 담당 B는 `redesign.js/index.template.html/redesign.css`를 소유한다.
`studio.js/profiles.js/character-document.js`·엔진·backend·모델·서버·설치 앱은 수정하지 않는다.
한정 예외로 총괄이 B에게 `app.js`의 v1 reset/import 확인·완료 문자열만 수정하도록 배정했다.
일반 작업 전환을 새 프로젝트 생성으로 오인시키지 않기 위한 copy-only 변경이며 기능/조건/인자/guard·외부 v2/v3 동작은 불변이다.
기존 후보 20개/문서 크기 제한과 외부 v2/v3/Live2D 경계를 유지하고 일반 기록을 자동 삭제하지 않는다.
QA는 일반↔project 왕복/재시작·명시 복사 저장·종류 유지 export·오류/경합·실제 9/14 보존을 검증한다.
CPU 행동검증·원문 hash와 실제 native 수용을 구분한다. build는 UI 통합 후 B가 한 번 수행한다.
