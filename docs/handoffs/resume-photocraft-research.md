# PhotoCraft 조사 완료 인계

2026-10-20 KST. 공식 제품 페이지와 `storytold/photocraft` README의 상호 링크를 확인했다. GitHub API의 main commit은 `3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3`이며 같은 commit의 Rust 소스 8개에서 명령 규격·문서 상태·undo/redo·COW·레이어/마스크·저장 진입점을 정적으로 확인했다.

완료 결과는 [photocraft-transfer.md](D:/Pankeki/docs/research/technical/photocraft-transfer.md)에 작동 원리 3개와 Pankeki 적용 아이디어 2개로 정리했다. 우선 제안은 후보 조작의 화면·대화 공통 명령 경로와 마스크 편집 체크포인트다. README 주장·직접 확인한 구현·추정 효과를 구분했고, 소스 링크는 commit으로 고정했다.

이번 변경은 `docs/research/technical/photocraft-transfer.md`와 이 인계 파일 두 개뿐이다. 생산 코드·기존 테스트·이전 프론트엔드 인계·백업은 수정하지 않았다. clone·의존성 설치·빌드·테스트 반복·새 채팅·하위 에이전트·외부 메시지·GPU 실행은 없었다.

검증 방법: 공식 사이트의 GitHub 링크를 열어 대상 저장소를 대조하고, PowerShell `Invoke-RestMethod`로 commit/tree(`truncated=false`), `Invoke-WebRequest`로 고정 raw 소스의 함수 본문을 확인했다. 첫 샌드박스 소켓 조회가 차단돼 도구 escalation 절차로 재조회했다. 최종 문서는 `Get-Content`로 읽어 산출물·commit 링크·길이를 점검했다. 자동 테스트나 앱 동작 검증 결과는 아니다.

한계: 모든 UI/CLI/MCP 호출부와 `.pcraft` 내부 직렬화·성능·이미지 품질은 검증하지 않았다. 다음 단계는 총괄이 두 제안의 우선순위를 정하고, 채택 시 프로젝트 버전/마스크 용량과 비동기 명령 세대 계약을 설계하는 것이다. 제안까지 완료했으며 추가 구현은 수행하지 않는다.
