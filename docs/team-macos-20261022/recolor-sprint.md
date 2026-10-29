# 정밀 색상 변경 — 팀 실행 계약

사용자 요청(2026-10-23): 기존 형태를 유지하면서 원하는 색만 바뀌도록 팀별 개선, 실제 결과 비교, 총괄 검토·통합을 수행한다. 기존 로고·11개 메뉴·생성·자유 부분 수정·후보/프로젝트·모션/출력을 보존한다.

## 설계와 원인

앞선 고정 비교 7건은 지시와 마스크가 전달돼도 색이 남거나 천 구조가 바뀌었다. 형태 보존을 요구하는 색 변경에는 확산 재생성 대신 원본 좌표에서 색 성분을 변환하는 경로를 추가한다. 기존 부분 수정 작업에 `edit_operation`만 더하고 기존 AI 부분 수정은 유지한다. 알고리즘은 원래 색 범위를 고르고 명암·하이라이트·선의 공간 구조를 보존한다. 새 모델/패키지/GPU는 사용하지 않는다. 결과를 AI 추론으로 표시하지 않는다.

## 공통 API

- 기존 `mode='inpaint'`, `source`와 `mask` 계약 유지.
- `edit_operation='recolor'`가 색상 변경, 기존 요청은 누락 또는 `'regenerate'`.
- `target_color`: 필수 `#RRGGBB`.
- `source_color`: `#RRGGBB` 또는 null/누락이면 마스크 안 대표색 자동 추정.
- `color_tolerance`: 유한 숫자 0..90, 기본 35도.
- `feather`: 기존 값과 범위. zero-mask RGB와 원본 전체 alpha는 정확 보존한다.
- txt2img + recolor는 거부한다. 색상 변경은 prompt·설치 모델·Comfy 연결에 의존하지 않으며 `kind='local_recolor'`, `model_calls=0`, cache off로 기록한다.
- 기존 jobs API·취소·result URL·recipe/metrics·후보·source/parent 연결과 저장 흐름을 사용한다. CPU 처리 실패를 AI 결과로 가장하거나 조용히 fallback하지 않는다.

## 파일 소유권

| 담당 | 범위 |
|---|---|
| 이미지 AI | 새 recolor 알고리즘, engine 최소 분기, 관련 Python 검사, 실제 전후 이미지 |
| 프론트 | app/redesign/template 및 필요한 profile/studio 최소 연동, 관련 JS 회귀 |
| QA | 독립 pixel/shape/color/alpha 검수 및 자기 증거, 제품 변경 없음 |
| UX | 실제 결과·화면 비평과 수용 판정, 자기 문서만 |
| 편집·모션 | 후보·문서·RGBA·출력·rig 계약 검토, 제품 중복 수정 없음 |
| Mac 출시 | 재시작/guard/오프라인 경계 읽기 검토, 프로세스 변경 없음 |
| 총괄 | 경계 확정·소스 검토·최종 빌드/재시작·실제 브라우저/API·수용 통합 |

각 담당 문서는 `docs/team-macos-20261022/recolor/`, 증거는 `runtime/macos/recolor-quality/<role>/`에 보관한다. 서버/공유 브라우저 조작은 총괄만 수행한다. 다른 채팅이나 하위 담당을 추가하지 않는다.

## 검증과 수용

실패 테스트를 먼저 재현한 뒤 구현한다. 원본·마스크·색상 값·버전/알고리즘·실제 요청·결과·recipe/metrics를 대응한다. 기존 실패 결과와 새 결과를 같은 원본에서 직접 비교한다. RGB 밖/전체 alpha 오차 0, 해상도·좌표 불변, 다른 색의 주변 보존, 선택 색 반영, 주름·술·선·명암과 경계를 확인한다. 단순 변경 픽셀 수로 품질 합격을 표시하지 않는다.

기본 마스코트 외에도 target red/green/black/white, fractional mask, 실제 비균일 alpha 원본을 검증한다. 자동 원래 색 선택이 애매한 경우 직접 선택으로 조절할 수 있게 한다. 서로 다른 그림의 모든 소재에 대한 무조건적 보존이나 자동 의미 분할을 보장하지 않는다.

통합 후 총괄은 관련 전체 Python/JS 검사와 1440×900 실제 UI에서 원본·마스크 불러오기→색상 변경→후보 비교→프로젝트 저장·복원/PNG 경계를 확인한다. 기록된 성공과 남은 문제를 분리한다.

## 최종 판정

2026-10-23 총괄이 위 범위의 구현·독립 검토·실제 UI와 파일 저장까지 수용했다. 기본 앱 8190에 통합했고 격리 검증용 8191 서버는 종료했다. 최종 비교 화면과 결과·검사·남은 한계는 [통합 검토](recolor/integration-review.md), 기계 판독 기록은 `runtime/macos/recolor-quality/integration/verification.json`에 있다. 자유 생성형 AI 편집의 정밀성 문제와 새 로컬 색상 변경의 수용을 구분한다.
