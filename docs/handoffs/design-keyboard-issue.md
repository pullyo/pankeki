# 후보 카드 키보드 포커스 손실 — 해결 확인

## 현재 상태: 해결됨

2026-10-19 22:15 KST에 최신 빌드를 실제 `http://127.0.0.1:8190/`의 독립 Chrome에서 재검증했다. 응답 HTML SHA-256은 `cc2001e9bff0dd9b318324d135b735983cf2df284112ba8d6c75fdffca3ac022`이며 디스크 빌드와 일치한다. 이 응답에는 현재 `app.js`가 포함되어 있다.

- 비교 선택 Enter: 같은 후보의 `비교 선택 해제` 버튼에 포커스 유지, `aria-pressed=true`, 선택 수 1/2.
- 비교 선택 해제 Enter: 같은 후보의 `비교 선택` 버튼에 포커스 유지, `aria-pressed=false`, 선택 수 0/2.
- 크게 보기 Enter: 같은 후보의 `크게 보기` 버튼에 포커스 유지. 이어 Tab은 같은 후보의 `이어서 수정`으로 이동.
- 비교 선택·해제 뒤 Tab은 다음 후보의 `크게 보기`로 정상 이동. BODY로 포커스가 소실되지 않음.
- 관련 회귀 검사를 포함한 66개 테스트 모두 통과. 이번 재검증의 생성 요청은 0건이며 페이지 오류도 없음.

해결 증거는 `visual-check/candidate-keyboard.json` 및 `15-candidate-compare-keyboard-after.png`, `16-candidate-view-keyboard-after.png`이다. 아래에는 기존 실패 재현을 역사 기록으로 보존한다.

## 최초 실패 재현 (보존)

검증: 2026-10-19 22:04 KST, 독립 Chrome headless, 1440×900, 실제 `http://127.0.0.1:8190/`.
응답 HTML SHA-256: `3c9a9759fea67a7a6300a3849c3b2b8fc88c9aae68a940998f941bc1199070a5`.

## 당시 확인된 문제 (P2, 현재 해결됨)

후보 카드의 **비교 선택** 및 **크게 보기** 버튼을 키보드 Enter로 실행하면 동작은 수행되지만 `document.activeElement`가 `BODY`로 바뀐다. 포커스 표시와 현재 조작 위치를 잃는다. 이어 Tab을 누르면 첫 후보의 첫 조작인 `크게 보기`로 이동하여 비교 버튼에서 하던 조작을 바로 이어갈 수 없다.

이는 완전한 키보드 조작 불능은 아니지만, 카드 변경 후 포커스가 유지되지 않는 접근성 문제다. 포인터 사용과 구분해 수정해야 한다.

## 재현 순서와 실제 결과

1. `work/character-studio/visual-check/verified-project-with-edit.json`을 불러온다. 후보 3개가 표시된다.
2. 첫 후보의 `비교 선택` 버튼에 포커스를 둔 뒤 Enter를 누른다.
   - 실행 전: `BUTTON`, text=`비교 선택`, candidateId=`14bf8543-7048-4d40-84fa-e5f921ace9fc`.
   - 실행 후: 선택 수 `1/2 선택 · 3/20 보관`, 새 `비교 선택 해제` 버튼의 `aria-pressed=true`.
   - 포커스: `BODY`로 소실됨.
   - 이후 Tab: 같은 첫 후보의 `크게 보기`로 이동.
3. 첫 후보의 `크게 보기` 버튼에 포커스를 둔 뒤 Enter를 누른다.
   - 선택한 후보의 이미지 표시와 `.active` 상태 변경은 성공.
   - 포커스: 다시 `BODY`로 소실됨.
   - 이후 Tab: 첫 후보의 `크게 보기`로 이동.

## 원인과 기능 담당 수정 제안

검토 당시 `web/src/app.js`의 `renderGallery()`는 `gallery.replaceChildren()`로 카드 전체를 다시 생성한다(약 525–547행). 비교 선택과 크게 보기의 이벤트 처리기가 이 함수를 호출하면서 현재 포커스를 가진 버튼을 제거하지만 새 버튼에 포커스를 복구하지 않는다.

기능 담당은 다시 그리기 전 후보 ID와 조작 종류를 보관해 같은 후보의 대응 버튼으로 포커스를 복구하거나, 필요한 상태만 갱신하여 현재 버튼 DOM을 유지하는 방법을 적용할 수 있다. `크게 보기`에서 미리보기 영역으로 포커스를 이동하는 제품 의도가 있다면 이름을 가진 초점 가능 영역으로 명시적으로 이동하고 돌아갈 경로를 제공해야 한다. 단순히 `BODY`에 남겨서는 안 된다.

디자인 담당은 `app.js`를 수정하지 않았다. 기능 담당의 수정 후 위 두 Enter 경로와 비교 선택 해제를 재검증하여 해결을 확인했다.

## 증거

- 당시 기계 검증: `D:\Pankeki\work\character-studio\visual-check\candidate-keyboard-before-fix.json`
- 당시 비교 선택 직후 캡처: `D:\Pankeki\work\character-studio\visual-check\15-candidate-compare-keyboard-after-before-fix.png`
- 당시 크게 보기 직후 캡처: `D:\Pankeki\work\character-studio\visual-check\16-candidate-view-keyboard-after-before-fix.png`
- 재현 스크립트: `D:\Pankeki\work\character-studio\verify-candidate-keyboard.cjs`

별도 키보드 검증에서 건너뛰기 링크→작업 공간, 도움말 열기·Esc 닫기·열기 버튼으로 복귀, 설정 패널을 Space로 접은 뒤 내부 입력을 건너뛰고 후보 수 선택으로 Tab 이동은 통과했다. 이 결과는 `visual-check/keyboard-layout.json`에 있다.
