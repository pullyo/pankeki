# 채팅 중심 작업실 DOM 계약 — 디자인 → 기능

2026-10-19. 사용자 최신 방향: 노드/긴 폼 중심이 아닌 대화가 주작업. 디자인 담당은 template/CSS/build만 수정하며 app.js/profiles.js/backend는 변경하지 않습니다.

## 기능 담당 연결용 새 ID

- `chatPanel`: 대화 패널 section/aside.
- `chatMessages`: `div.message-log`, role=log, aria-live=polite, 스크롤 영역. 실제 사용자·도구·모델 메시지를 append. `.chat-message.user`, `.chat-message.assistant`, `.chat-message.system` + `.message-body` 권장. 꾸며낸 AI 답변을 기본 삽입하지 않습니다. 실제 이미지 `status`는 중복 live 알림을 피하려고 log 밖의 형제 영역에 있으며 같은 대화 패널의 입력창 위에 항상 표시됩니다.
- `chatEmpty`: 연결 전/빈 대화 안내. 메시지가 생기면 hidden 처리 가능.
- `chatInput`: textarea, maxlength=4000, 실제 대화 입력. `brief`/`prompt`와 별개입니다. 비어 있을 때 보내기 금지. Enter/Shift+Enter 정책은 기능 담당이 구현하고 안내와 일치시킵니다.
- `chatSend`: button type=button. 초기 disabled. 대화 기능 연결 후 활성화. 대화 전달/계획/도구 실행 상태는 기능 담당이 관리합니다.
- `chatModelStatus`: span, 초기 “로컬 대화 모델 미연결”. 확인된 실제 모델/상태만 표시.
- `chatNotice`: p role=status, 실제 연결/오류/실행 안내.
- `chatAttachment`: div hidden, 첨부 표시 용도. 파일 picker는 기존 `upload`를 그대로 사용합니다. 연결 전에는 기존 원본 가져오기·부분수정 기능으로 동작하며 모델에 이미지를 이해시킨다고 표시하지 않습니다.
- `chatComposer`: 입력창 컨테이너. 새 form은 아니므로 기존 버튼의 submit 부작용 없음.
- `detailPanel`: details. 기존 캐릭터 설정 전체 `briefDrawer`를 내부로 이동합니다. 모든 기존ID/type/maxlength 유지.
- `showChat`, `showResult`: 좁은 화면의 대화/결과 전환. 템플릿의 표시 전용 스크립트가 관리합니다. 결과를 열면 `data-mobile-view=result`, 대화는 chat.
- `chatViewResult`: 실제 후보가 있을 때만 표시하는 결과 화면 바로가기. `mobileCandidateCount`: 실제 갤러리 카드 수를 표시하는 모바일 후보 바로가기의 숫자. DOM 관찰로 현재 값만 표시합니다.

## 보존되는 기존 기능

`projectName`은 상단, 모든 저장/불러오기/보드 버튼과 상태 유지. `brief`, `appearance`, `profile`, `prompt`, 팔레트/노트/고급옵션은 detailPanel 안. `generate`는 상세설정의 기존 이미지생성 버튼이며 chatSend와 별개로 보존합니다. 실제 캐릭터 후보 생성·마스크·비교는 기존기능으로 작동합니다.

대화 모델이 연결되기 전 chatSend는 비활성으로 표시합니다. 상단 안내와 실제사용 가능한 ‘상세설정으로 생성’ 경로를 제공하며 실제채팅동작완료라고 보고하지 않습니다. 모델/API 새연결은 기능 담당 작업이 필요합니다.

## 레이아웃 전환

대화왼쪽+큰중앙캔버스+오른쪽후보. 비교는 캔버스 자리에서 표시하며, 템플릿 표시전용 이벤트가 기존 closeCompare를 호출해 보기/부분수정/모드변경 시 비교를 닫습니다. 기존비즈니스상태와 파일처리는 app.js 소유입니다. 반응형 전환/시작버튼만 템플릿이 관리합니다.

원본·마스크는 같은 sourceStage의 표시사각형으로 맞춥니다. 템플릿 ResizeObserver는 캔버스 컨테이너 가용 크기와 원본 bitmap 비율을 읽어 stage의 CSS width/height만 설정합니다. 원본/마스크 픽셀, bitmap width/height, 브러시 좌표계는 변경하지 않습니다. 모바일 후보 보기/수정 선택은 캔버스 위치로 스크롤합니다.

기능 담당은 연결한 상태/추가 계약을 이 문서 또는 function-ready.md에 명시해 주세요. 디자인은 최신 기능 소스를 다시 빌드하여 실제대화/실제후보 흐름을 검수합니다.
