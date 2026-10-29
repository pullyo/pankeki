# 실제 2D 움직임 우선 프론트엔드 누락 감사

2026-10-20 KST · **읽기 전용 소스 감사. 현재 실제 2D 메시 움직임은 미구현이다.** [문서 계약 v0.1](character-document-contract.md), [합성 fixture](fixtures/character-document-v2.fixture.json), [warm 인계](warm-frontend-implementation.md)를 현재 `web/src`의 app.js/profiles.js/studio.js/template과 대조했다. 아래 ‘구현’은 코드 존재 판정이며 이번에 실행·성능·화면을 검증했다는 뜻이 아니다.

## 구현과 계획 구분

| 항목 | 판정 | 현재 파일 근거와 남은 범위 |
| --- | --- | --- |
| 생성·후보·수동 마스크·정지 저장 | **실제 구현** | [app.js](D:/Pankeki/web/src/app.js:464)의 generate와 기존 후보/마스크 핸들러, exportProject/exportBoard. 정지 이미지 작업의 기반이며 메시 변형은 아님 |
| 프로젝트 v2·v1→v2 | **미구현** | [profiles.js](D:/Pankeki/web/src/profiles.js:247)의 project는 version1과 brief/versions/selectionHistory만 허용. app.importProject도 기존 parseProject 호출. 별도 v2 문서/자산 모듈 없음 |
| 부위·투명 소재·계층 | **미구현** | [parts 화면](D:/Pankeki/web/src/index.template.html:112)은 준비 안내와 disabled 조절. app.loadSource는 전체 원본 하나를 보관하며 part/asset 레지스트리·분리 소재·배경 준비 데이터가 없음 |
| 메시·UV·키폼·삼각형 그리기 | **미구현** | [studio.js](D:/Pankeki/web/src/studio.js:35)의 refresh는 img.src와 요약 갱신. `evaluatePose/drawPose`는 계약의 제안 이름으로만 존재. fixture의 좌표/hash는 구현·렌더 결과가 아님 |
| 눈·입·호흡 | **미구현** | [motion 화면](D:/Pankeki/web/src/index.template.html:117)의 warmEyeOpen/warmMouthOpen/warmBreathing은 disabled fieldset. JS에 파라미터 값·binding 계산/연결 없음 |
| 재생·48 PNG 프레임 출력 | **미구현** | motion 재생 버튼과 export의 PNG 연속 프레임이 개발 예정. template의 requestAnimationFrame은 원본 canvas 표시 크기 맞춤용. app.exportBoard는 정지 보드 1장 생성이며 타임라인·프레임 샘플러/출력기 없음 |
| 문서/마스크 undo·redo | **미구현** | [app.recordSelection](D:/Pankeki/web/src/app.js:516)은 view/edit/compare 선택 기록. clearMask는 검정 채움이며 이전 획 복원 이력이 없음. 생성 취소는 job 결과 폐기 경로 |
| 마스크 편집과 영속 저장 | **부분 구현** | [app.requestSnapshot](D:/Pankeki/web/src/app.js:414)이 현재 paint를 PNG로 제출. profiles.validateRequest는 createProject 시 source/mask를 출력에서 제외하고 저장 파일 import에서는 거절. import는 마스크 재지정 안내. **v1은 설정·후보·선택 기록 저장이며 편집 전체 저장이 아님** |
| 원본 버전/늦은 응답 무효화 | **부분 구현** | [app.loadSource](D:/Pankeki/web/src/app.js:342)의 sourceRevision, maskRevision·serial·importRevision/editEpoch로 기존 업로드/생성/복원 역전 방어. asset/rig hash, 소재 변경 뒤 preset/motion stale, undo의 단조 revision, Codex project_token 연계는 계약만 있고 JS에 없음 |

## 계획에서 더 정의할 부분

목표 항목 자체는 계약에 있으나 다음 **구현 정책은 아직 빠져 있다**. 기존 계약/fixture를 수정하지 않고 후속 합의 항목으로 남긴다.

- **키폼/복합 pose 판정:** 계약 §2~3의 유효 면적 원칙에 더해 기본 파라미터값에서 base와 delta의 관계, 여러 binding 합산 후 삼각형 뒤집힘·퇴화의 임계값과 실패 시 정지/차단 정책을 고정해야 한다. fixture는 단일 binding의 중간 좌표이며 복합·부모 변형의 실행 검증이 없다.
- **재생 상태:** 계약은 곡선과 24fps 샘플 시각을 정했으나 clock·pause/seek/loop 경계, 사용자 슬라이더와 재생의 우선순위, 재생 중 저장할 값, 매 프레임을 undo에 넣지 않는 규칙이 미정이다. fixture.document.motions도 빈 배열이다.
- **프레임 전달:** 2초·48프레임 외에 파일명/순서·ZIP 또는 개별 PNG 전달, 배경/알파 옵션, 진행·취소·부분 실패 시 산출물 처리 규칙이 미정이다. 기존 정지 PNG/보드 내보내기를 그대로 완료 근거로 삼을 수 없다.
- **문서 명령:** 계약 §4는 원자적 command/이력 상한을 정의했지만 type별 args·inverse patch·소재 교체와 종속 rig 무효화를 한 undo로 묶는 명세는 아직 없다. 준비 소재/배경의 확인 주체와 ‘움직임 가능’ 전환 검사도 UI와 문서 모듈 사이에 고정해야 한다.

## 최소 선행조건과 구현 소유 경계 제안

1. 총괄·프론트·렌더러 담당이 위 정책과 기존 `evaluatePose → drawPose` I/O를 먼저 고정한다. 합성 fixture로 실제 중간 정점·텍스처 삼각형·부모 affine을 검증한 뒤, **수동 준비한 캐릭터 RGBA 소재/필요한 배경** 한 세트로 실제 눈·입·호흡을 보이는 작은 흐름을 만든다. 준비 안 된 소재/가려진 면은 차단한다. Codex나 새 이미지 추론은 이 기술 선행조건이 아니다.
2. 문서 상태와 렌더러를 병렬 구현하고, 파라미터 조절·재생은 같은 pose 평가를 사용한다. 이후 v2 저장 재개/undo/원본 무효화와 48프레임 출력을 연결한다. 합성 색 블록의 움직임만으로 캐릭터 제작 완료라고 판정하지 않는다.

| 소유 | 제안 파일 경계와 결과 |
| --- | --- |
| 프론트 문서 | 신규 `web/src/character-document.js`: v2 parser/자산 참조·v1 변환·명령/undo·revision·rig stale. 기존 profiles.js의 v1 공개 API 유지 |
| 기술/렌더러 | 신규 `web/src/character-renderer.js`: 순수 pose 평가·중간 정점·UV/계층·주어진 canvas 렌더. DOM·저장·네트워크를 소유하지 않음 |
| 프론트 연결 | 신규 `web/src/character-motion.js`: 파라미터/재생·샘플링/프레임 전달 조율. app.js는 기존 원본/마스크/job 연결, studio.js는 탐색 유지. 렌더러 수학을 중복 구현하지 않음 |
| 디자인 | 기존 template/CSS/build: 준비·차단·stale·재생/출력 상태와 조작. 합의 후 실제 가능한 컨트롤만 활성화하며 문서/렌더 JS는 공동 편집하지 않음 |

이번 변경은 **이 감사 파일 1개**다. 코드/fixture/기존 인계는 변경하지 않았고 테스트·빌드·서버·GPU·의존성 설치·새 채팅/하위 에이전트를 실행하지 않았다. 기존 warm 92개 통과 기록을 움직임 기능의 통과로 확대하지 않는다. 다음 결정은 총괄의 정책 확정과 위 파일 소유 배정이며, 현재는 구현 착수 전이다.
