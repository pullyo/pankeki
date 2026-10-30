# 편집·표정·모션·출력 인수인계

2026-10-22 KST · 담당: Pankeki 편집·모션 개발자 · 상태: 정적 인수인계 완료, 다음 배정 대기.

## 역할과 기준

캐릭터 v2 문서, 부위 편집, 표정 파라미터·키폼·재생, PNG/프레임 출력을 맡는다. 기준 프로젝트는 `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki`이며 아래 근거 경로는 이 루트 기준이다. `docs/TEAM-MACOS-20261022.ko.md`, `DESIGN.md`와 최신 Mac 복원·UI 검증 기록을 따랐다. 기존 로고·11개 메뉴·생성/마스크/후보/프로젝트/모션/출력은 보존 대상이다. app.js 연동은 프론트 담당, 회귀 수용은 QA, 통합·재빌드는 총괄과 조율한다.

## 이번에 소스로 확인한 구현

| 범위 | 확인 내용과 근거 |
|---|---|
| 문서·편집 | `web/src/character-document.js`: v1→v2 변환과 자산 바이트 보존, 자산 SHA·크기·참조 검증, 원자적 명령과 revision 검사, undo/redo. 소재·키폼·기준 원본 불일치 리그는 stale 처리한다. 이력은 최대50상태/32MiB이며 저장·재가져오기 시 undo 이력은 복원하지 않는다. |
| 렌더링 | `web/src/character-renderer.js`: 격자 생성, 키폼 선형 보간·변위 합산, 부모 변환/가시성/투명도, Canvas2D 출력. 부위·소재·배경 확인·ready 리그가 필요하고 미준비/뒤집힌 기하를 차단한다. 모션은 한 변1024px 이하, 최대16부위, 메시당256정점이다. |
| 표정·움직임 | `web/src/character-motion.js`: 분리 PNG 일괄 가져오기, 배경/투명 장면 수동 확인, 격자·점·키폼 편집, 표정 프리셋, 눈/입/호흡의0..1 파라미터와2초/24fps 곡선, 재생·일시정지·seek·v2 저장. 기본 동작은 깜빡임·호흡이다. 문서 교체 시 대기 명령·RAF·출력에 세대 가드를 둔다. |
| 출력 | `web/src/character-export.js`: 같은 렌더러로 현재 pose PNG와 `frame-0000..0047.png`+manifest의 ZIP을 만든다. 시각은 k/24, PNG 누적 상한128MiB. 문서/동작 snapshot, PNG 청크 CRC·크기 검사, AbortSignal, 실패 시 미완성 ZIP 미반환, 임시 canvas 해제가 구현돼 있다. |

관련 테스트 소스는 `scripts/test_character_document.cjs`, `test_character_renderer.cjs`, `test_character_motion.cjs`, `test_character_export.cjs`, `test_motion_app.cjs`를 읽었다. 원자성·stale·문서 교체 경쟁·취소·48프레임 계약 검사가 있으나 모션의 DOM/디코더/시계와 출력의 Canvas/인코딩에는 대역이 포함돼 실제 픽셀 수용과 구분해야 한다.

## 기존 검증 기록과 미확인 범위

- **Mac 기록(이번 실행 아님):** `runtime/macos/restore-status.json`은 예제 로드·재생/일시정지·v2 저장·PNG 출력 액션·48프레임 ZIP 완료 UI·재시작 후 복원을 보고한다. `runtime/macos/pc-chat-ui/verification.json` 및 `javascript-tests.log`는 관련9개 suite 전체144건/142통과/1skip/1TODO/0실패를 기록한다. skip은 실제 브라우저 알파 이음새 검사, TODO는 RGBA/중간 pose 검사다. 네이티브 Mac 다운로드 도착도 남은 검증 항목이다.
- **Windows 역사 자료:** `docs/handoffs/motion-qa-results.md`와 `motion-renderer-pixel-qa.md`에는 예제·자체 준비 PNG의 픽셀/48프레임 ZIP 수용 및 이음새 수정 수용이 있다. 이번에 네 코어 파일의 SHA-256이 당시 QA 표와 같은 것을 확인했다. 같은 바이트라는 사실을 Mac 브라우저 픽셀·성능 통과로 확대하지 않는다. 과거 D: 경로·origin·성능값도 현재 값이 아니다.
- **남은 한계:** 사용자 고유 캐릭터의 적합한 분리 PNG 세트 전체 흐름, Mac 실제 탭 숨김·출력 중 문서 교체의 실동작,1024px/16부위 부하 성능은 이번에 확인하지 않았다. 모든 부위의 격자·배경을 준비해야 점 편집이 가능하다. 자동분할·자동 리깅·가려진 영역 복원·정밀 인물 동일성 보장을 이 네 모듈의 구현으로 볼 근거는 없다. `backgroundReady`는 사용자의 수동 확인 상태다.

## 다음 작업 상위3개와 완료 기준

다음 배정에서 수행할 후보이며 이번에는 실행하지 않았다.

1. **사용자 분리 소재의 Mac 편집 흐름 수용.** 적합한 PNG 세트로 가져오기→배경 확인→배치/부모→모든 격자→키폼→눈/입/호흡→저장/재가져오기를 QA와 확인한다. 완료 기준: 자산 바이트·UV·연결 보존, 무효 입력 시 마지막 문서/화면 보존, 재개 pose 일치와 실제 조작 증거.
2. **Mac 출력 실물·픽셀 검증.** PNG와48프레임 ZIP의 실제 다운로드 도착 및 독립 판독을 확인한다. 완료 기준: PNG48개+manifest 총49항목, CRC·크기·k/24·리그 해시 일치, 동일 조건 native PNG 기준 RGBA/투명도 일치, 취소/실패 후 완성 파일0개.
3. **Mac 재생 성능·문서 교체 경계 검증.** 실제 탭 숨김/복귀, 재생·출력 중 교체와 늦은 콜백, 비선형 메시 및 상한 부하를 측정한다. 완료 기준: 옛 문서 commit/RAF/다운로드 유입0, 정지 pose 유지, 장면별 평균/p95·입력 지연 기록과 기존30fps/100ms 목표 충족 여부 명시.

## 변경 파일

`docs/team-macos-20261022/handoffs/editor-motion.md`만 신규 작성했다. 이번 작업은 소스·기존 자료 읽기와 해시 대조 및 이 문서 작성만 수행했다. 테스트·빌드·브라우저·추론·다운로드·서버 재시작·외부 게시·다른 채팅 메시지·추가 채팅/하위 에이전트 생성은 실행하지 않았다.
