# 채팅 → 이미지 작업 연결 계약

2026-10-19. 총괄이 전달한 채팅 중심 방향용 인터페이스. **로컬 LLM은 아직 연결하지 않았으며 모델 선정·다운로드도 하지 않았다.** 현재 이미지 SDK 연결 및 SDXL 비교 작업을 유지한다.

화면은 대화와 이미지 캔버스를 중심으로 구성한다. 노드 편집기는 필요하지 않다. LLM 공급자 교체는 대화 어댑터 내부에서 처리하고 이미지 생성은 기존 `/api/jobs` 계약을 유지한다.

대화 어댑터 입력:
```json
{"message":"가방을 빨간색으로 바꿔줘","brief":{},"context":{"sourceCandidateId":"후보 ID","selectedCandidateIds":[],"hasMask":true},"generationRequested":true}
```

대화 어댑터의 검증 대상 출력:
```json
{"reply":"선택한 영역의 가방을 빨간색으로 바꾸겠습니다.","briefPatch":{},"action":{"type":"prepare_edit","prompt":"red leather satchel, brass buckles","sourceCandidateId":"후보 ID"}}
```

- `action.type`은 `none`, `prepare_generate`, `prepare_edit`만 허용한다. 일반 대화에서는 `none`; 사용자의 생성·수정 지시가 있을 때만 실행한다. LLM이 자발적으로 도구를 요청한 것만으로 제출하지 않는다.
- `briefPatch`는 기존 브리프의 허용 필드와 길이 제한으로 검증한다. 프롬프트·설정 초안을 화면에 반영하고, 임의 코드·경로·URL·워크플로 노드는 실행하지 않는다.
- 이미지 바이트와 마스크는 앱이 보관한다. LLM이 반환한 ID는 현재 프로젝트 후보에 실제 존재해야 한다. 편집은 선택한 원본과 마스크가 모두 준비되었을 때만 제출한다. 모호한 수정 대상은 질문으로 확인한다.
- 제출 시 브리프·원본·마스크·설정의 현재 스냅샷을 고정한다. 기존 `POST /api/jobs {session,request}` → job ID → `GET /api/jobs/{id}` → `/api/results/{id}` 흐름을 사용한다. SDK 영수증/실제 job 상태를 근거로만 완료를 표시한다.
- 취소·늦은 응답·후보 전환은 기존 revision 검사에 따른다. 대화 응답과 이미지 작업 상태를 따로 관리해 LLM 답변 완료를 이미지 생성 완료로 표시하지 않는다.
- 미연결 시 채팅 입력에 **‘로컬 대화 모델 미연결’**을 표시하고 설정 경로를 안내한다. 고정된 가짜 답변이나 가짜 생성 상태는 사용하지 않는다. 기존 이미지 생성 기능은 독립적으로 사용 가능하다.

디자인 구현에 필요한 상태: `disconnected`, `ready`, `replying`, `needs_input`, `image_queued`, `image_running`, `image_succeeded`, `error`. 실제 LLM HTTP 라우트는 아직 구현하지 않았으므로 이 문서를 연결 완료 근거로 사용하지 않는다.
