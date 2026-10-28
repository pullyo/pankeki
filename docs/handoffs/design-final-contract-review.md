# 최종 DOM·접근성 계약 검토

최종 검증 시각: 2026-10-19 22:15 KST. 제품 파일은 수정하지 않았고 GPU 생성도 실행하지 않았다.

## 결론

필수 ID, 입력 이름, ARIA 연결, 기본값과 길이 제한은 통과했다. 새로 확인된 높은 우선순위 문제는 없다. 기존 후보 카드 포커스 P2는 최신 실제 화면에서 **비교 선택·해제와 크게 보기 모두 해결을 확인**했다. 관련 회귀 검사를 포함한 66개 테스트도 모두 통과했다.

## 확인한 버전

- 실제 8190 응답과 `web/index.html` SHA-256이 일치: `cc2001e9bff0dd9b318324d135b735983cf2df284112ba8d6c75fdffca3ac022`.
- 응답에 현재 `app.js`가 포함됨 (`servedContainsCurrentApp=true`). 앱 소스 SHA-256: `6d46b9bd400fb301bd7a20399b879564d021a7fa027b89069cb562e229a6e5d7`.
- 템플릿 SHA-256: `0b4bf4ea8e158fbbf23ee28f339999c42bb101327616eabf2242b058415ca5ae`.
- CSS SHA-256: `5e526b313385d209f9e42776d69e58bdf5f83aff052d421c526e47c9f0603f80`.
- profiles SHA-256: `fa9d66c3ce59ea690f098b4ac52029e07f3ffb05f6ebdd89dec21aa2f00a02df`.
- 위 버전의 로고는 현재 제품 미리보기 상태이며 후속 로고 편집의 승인이나 최종 선정 결과를 이 검증이 대신하지 않는다.

## 통과 항목

- 템플릿 ID 94개에 중복 없음. 앱의 리터럴 ID 참조 68개가 모두 템플릿에 존재. TEAM-CONTEXT의 새 캐릭터·프로젝트·갤러리·비교 ID도 모두 존재.
- `aria-labelledby`와 `aria-describedby`에 끊어진 참조 없음.
- 정적 입력·버튼·링크·summary 61개를 검사했으며 사용자용 조작에 이름 누락 없음. 내부 상태용 숨은 `erase` checkbox는 사용자용 조작으로 세지 않음.
- 용도 값 `original/comic/avatar/mascot/game`과 표시 이름 자유 창작·웹툰/웹소설·버튜버·마스코트·게임 유지.
- 이름 80, 소개·외형·노트 1200, 상세 800, 추가 지시 4000자 제한 확인.
- 팔레트 3개는 `type=color`이며 구별되는 접근 가능한 이름을 가짐.
- `useBrief` 기본 체크, 후보 수 기본 2, `compiledPrompt`는 PRE, 비교 패널은 초기 hidden.
- 도움말 dialog의 이름은 `helpHeading`에 연결됨. 원본/결과와 브러시/지우개 조작에는 상태를 나타내는 aria-pressed가 갱신됨.
- 프로젝트 상태·생성 상태·선택 수에 라이브 영역이 있음. 파일 업로드 입력과 표시용 라벨이 연결됨.
- 비교 패널 열기는 tabindex=-1 후 패널에 focus, 닫기·Esc는 비교 버튼으로 복귀하는 경로가 있음.
- 이전 실제 키보드 검증에서 건너뛰기 링크, 도움말 Esc·복귀, native details 패널의 숨은 입력 건너뛰기가 통과함. 마스크 그리기는 여전히 포인터 전용이며 키보드용 파일 마스크 업로드가 제공됨.
- `hasWork()`는 현재 브리프와 빈 브리프 snapshot, busy/source/project 상태를 비교하도록 수정되어 있음.

## 기존 포커스 P2의 변경 상태

22:06:09 소스에서는 `renderGallery()`가 현재 버튼을 제거하고 포커스를 복구하지 않았다. 22:10:51 소스의 약 526–573행은 현재 조작의 `dataset.action`과 후보 ID를 보관한 뒤, 새로 만든 대응 버튼에 `focus({preventScroll:true})`를 호출한다. 보기·수정·비교 조작에 각 action 값도 설정한다.

실제 8190에서 `verify-candidate-keyboard.cjs`로 비교 선택·해제와 크게 보기를 Enter로 실행했다. 세 경로 모두 동일 후보의 해당 버튼에 포커스를 유지했다. 선택·해제 후 Tab은 다음 후보의 크게 보기로 이동했고, 크게 보기 후 Tab은 같은 후보의 이어서 수정으로 이동했다. 이 결과로 기존 P2를 해결 처리했으며, 최초 실패 JSON과 캡처는 `-before-fix` 이름으로 보존했다.

## 최종 화면·기능 재검증

- `node --test scripts/test_ui_state.cjs web/tests/profiles.test.cjs work/character-studio/board-renderer.test.cjs`: 66/66 통과, 실패·취소·건너뜀 없음.
- 기존 저장 프로젝트에서 후보 3개를 복원. 새 빈 화면에서 불러오기 확인창이 발생하지 않음.
- 데스크톱 1440×1000에서 설정 접기 전후 캔버스 폭 970→1092px. 두 후보 비교 패널의 이미지 2개, 패널 포커스, Esc 후 비교 버튼 복귀 확인.
- 모바일 390×844에서 설정 접힘 상태와 문서 폭 390px 확인. 비교 카드는 단일 열 332px로 배치됨.
- 별도 오프라인 컨텍스트에서 후보 3개 복원, 각 이미지 complete=true 및 512×512 확인.
- 최종 데스크톱·모바일 캡처를 직접 검토하여 주요 조작과 이미지의 겹침이나 가로 잘림을 찾지 못함.
- 생성 POST 0건, JavaScript 오류 0건, 불필요한 확인창 0건.

## 낮은 우선순위 개선 여지

동적 후보 버튼은 모두 이름이 있지만 `크게 보기`, `이어서 수정`, `비교 선택`이 카드마다 동일하다. 스크린리더의 버튼 목록 탐색에서 후보를 구별하기 쉽게 후보 이름을 aria-label에 포함하거나 카드 제목과 연결하면 더 좋다. 현재 화면의 텍스트 이름 누락이나 계약 불일치로 판단한 것은 아니다.

## 증거와 범위

- DOM 검사: `D:\Pankeki\work\character-studio\visual-check\final-contract-dom.json`
- 검사 스크립트: `D:\Pankeki\work\character-studio\audit-final-contract.cjs`
- 최종 화면 결과와 소스·빌드 해시: `D:\Pankeki\work\character-studio\visual-check\final-ui-check.json`
- 키보드 수정 확인: `D:\Pankeki\work\character-studio\visual-check\candidate-keyboard.json`
- 최신 캡처: `17-final-desktop-canvas.png`, `18-final-desktop-compare.png`, `19-final-mobile-canvas.png`, `20-final-mobile-compare.png` (위 visual-check 폴더).
- 기존 실제 포커스 재현과 해결 기록: `D:\Pankeki\docs\handoffs\design-keyboard-issue.md`

이번 검증 범위는 현재 Chrome의 소스·DOM 계약, 키보드 포커스, 반응형 화면과 프로젝트 복원이다. 브라우저별 보조기기 호환성 전체를 인증한 것은 아니다.
