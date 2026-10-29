# 데스크톱 채팅 정리 설계

## 요청과 선택

사용자는 기존 채팅의 디자인·배치·기능을 정리하는 추천안을 선택했다.
기존 Operate 화면을 다듬으며 새 시안·다중 채팅·채팅 목록·전문 영속 저장은 만들지 않는다.
좁은 대화 열로 재설계하는 대신 현재 가로로 넓은 작업공간을 유지한다.
고정 960px 제한을 새로 적용하지 않고 요청·답변·이미지의 간격과 시작선을 맞춘다.
이미지 밖으로 편집·저장 액션을 옮기는 대안은 기존 사용자 선택과 충돌하여 제외한다.

## 보존 계약

팬케이크 로고·cream/brown/orange·Pretendard·11개 사이드바를 유지한다.
일반 생성과 명시적 프로젝트의 저장·전환·복사 계약을 바꾸지 않는다.
기존 단일 자동 composer와 Enter/Shift+Enter·한글 IME·busy 경계를 유지한다.
원본·마스크·초안·selection·후보·source identity·정확한 취소·파일 저장을 유지한다.
오른쪽 편집기는 기존 이미지 클릭 경로로만 열고 데스크톱 38:62 비율을 유지한다.
작은 창의 기존 대화/편집기 전환을 유지하고 도구나 상태를 잘라 숨기지 않는다.

## 입력창과 도구행

한 줄 입력의 composer 본체는 약 72–104px, 목표 약 96px로 줄인다.
입력에 따라 높이를 늘리되 정상 한 도구행에서는 본체 최대 약 160px로 제한한다.
textarea는 기존 DOM 하나를 재사용하며 긴 입력은 내부 스크롤로 읽을 수 있다.
첨부·AI 대화 모델·이미지 모델·해상도·옵션을 한 도구행 기준으로 정렬한다.
긴 명칭은 실제 값을 표시하면서 말줄임하고 전체 title/접근성 이름을 제공한다.
좁은 편집기 pane에서는 도구행을 자연스럽게 줄바꿈한다. 버튼·오류·취소를 숨기지 않는다.
보내기는 도구행 끝의 주 액션으로 남기고 실제 연결·busy 상태의 disabled를 유지한다.
진행·취소 중·완료·오류는 기존 사실 상태를 간결하게 표시하며 성공을 추정하지 않는다.

## 대화와 결과

요청·AI 답변·이미지 결과의 간격과 저자·모델 metadata 계층을 통일한다.
긴 본문은 읽기 좋은 줄 길이를 쓰되 결과 이미지와 작업공간 전체 폭을 줄이지 않는다.
편집·저장 액션은 이미지 안 overlay로 유지하고 클릭 영역·키보드 포커스를 보존한다.
기존 최신 결과 따라가기와 사용자의 과거 대화 스크롤 위치를 유지한다.
AI 답변의 실제 plain text에 답변 복사를 제공하며 이미지나 오류를 답변으로 꾸미지 않는다.
복사 실패는 실제로 알리고 복사 성공을 허위로 표시하지 않는다.
검증된 setChatModel 응답 conversationReset===true만 runtime contextEpoch를 늘리고 message epoch 사이에 “새 AI 문맥 시작”을 표시한다. 원문 대화는 보존하고 provider 선택·실패·noop은 경계를 만들지 않는다.

## 실패 요청 다시 입력

실제 실패한 현재 문맥의 요청에만 명확한 “다시 입력”을 제공한다.
기존 messages/requestId/lastFailure를 사용하고 취소나 추가 입력 요구를 실패로 추정하지 않는다.
동작은 원문을 기존 입력창에 복원하고 focus하는 것뿐이며 자동 AI 요청은 0회다.
새 입력이 있으면 무단 덮어쓰지 않는다. 같은 원문이면 focus만 돌려줄 수 있다.
진행 중·IME·다른 문맥으로 전환된 오래된 버튼에서는 기존 입력과 작업을 보존한다.
컨트롤러 failure metadata가 부족하면 A/root와 계약을 맞추고 UI가 실패를 발명하지 않는다.
A는 finish(error|limited)에 소유 요청의 기존 lastFailure{requestId,text,code}를 보완한다. contextEpoch는 초기/프로젝트 교체 시 0이며 user/assistant에 동일 값을 기록한다.

## 소유와 수용

B는 redesign.js/redesign.css, A는 desktop-chat.js의 모델·해상도·문맥 표시를 소유한다.
index.template.html 변경이 필요하면 B가 근거를 먼저 root에 보고한다. QA만 테스트를 편집한다.
root 설계 검토와 QA의 의미 있는 RED 뒤 UI build 1회를 완료했다. 현장 복사 실패에 대한 아래 필수 출시 보완을 예외로 둔다.
profile·DB·서버 설정·실제 모델·CSP·다른 권한·다운로드·GPU는 변경하지 않는다. 실제 앱 종료/시작은 root만 담당한다.
before/hash/patch는 output/finalization-20261029/chat-cleanup/frontend/에 보관한다.
CPU 행동·격리 시각 검증과 설치 앱의 root native 수용을 분리한다.

## 현장 복사 실패에 따른 출시 보완

root의 실제 앱 검토에서 deny-all Electron 권한 정책 때문에 답변 복사가 실패했다. 이는 별도 사용자 승인을 새로 가정한 기능 확장이 아니라 root가 실제 결함 근거로 허용한 필수 수정이다.
A는 desktop/main.cjs·security.cjs와 해당 security 테스트만 보완해 현재 앱의 정확한 origin/mainframe/window에 clipboard-sanitized-write만 허용한다. 읽기·외부 창/주소·subframe·누락/비정상 정보와 다른 권한은 계속 거절한다.
desktop 내용이 sourceID에 포함되므로 A 동결 후 식별자용 HTML build 1회를 추가하고 source meta 외 전체 바이트 동일성을 증명한다. 웹 UI 3파일과 시각 배치는 바꾸지 않고 새 렌더를 반복하지 않는다.
B는 기존 freeze-release/package-mac 스크립트와 검증된 로컬 ZIP으로 release/ 아래 새 앱·DMG를 만든다. 기존 앱/ASAR 수동 패치·권한 fallback은 금지하며 같은 profile/partition/origin을 유지한 새 앱 실기 수용은 root가 별도로 수행한다.
