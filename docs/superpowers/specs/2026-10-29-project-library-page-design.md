# 전용 프로젝트 화면

사용자가 **전용 프로젝트 화면 (추천)** 을 선택했다. 기존 직원 구현·독립 QA·root의 실제 네이티브 검토 방식으로 진행하며 배치 승인을 반복하지 않는다.

- 프로젝트 팝업을 중앙의 정식 `projects` 화면으로 바꾼다. 제목은 **프로젝트**다.
- 기존 실제 catalog의 큰 미리보기·이름·수정 시각·후보 수·사용 중 표시를 약260–360px 카드 그리드로 보여준다. 현재2개를 화면 전체로 늘리지 않는다.
- 저장 프로젝트 개수에는 새 상한을 두지 않는다. 전용 화면은20개/페이지이며21번째 이후도 기존 pagination 동작으로 접근한다.
- 홈 오른쪽 목록, 새 프로젝트/열기/파일 저장, 기존 switch/remove guard를 재사용한다. 프로젝트 화면 검색은 홈 검색과 독립하며 한 입력만 보인다.
- 기존 cream/brown/orange·Pretendard·Operate 기준을 유지한다. 새 hero/상시 오른쪽 패널/중첩 카드/가짜 항목·시간·이미지는 추가하지 않는다.
- 진입/화면 복귀는 문서·원본 이미지 bytes·현재 mode·초안/선택 범위를 바꾸지 않는다. 실제 전환은 기존 확인·저장 경계를 따른다. DB/문서 포맷/metadata/엔진/서버/설치 앱은 수정하지 않는다.
- 상태는 실제 loading/empty/search-empty/error를 구분하고 focus·disabled·반응형·reduced-motion을 유지한다. 목표 viewport는1280×800/1440×900/1920×1080이며 root의 실제 native 관측과 B의 격리 capture 결과를 구분 보고한다.

정적 page/heading placeholder를 template에 두어 먼저 mount하는 workflow의 page snapshot에 포함한다. 기존 catalog row/상태/전환 handler를 그대로 연결하고 프로젝트 화면 CSS에만 큰 preview 배치를 적용한다.
