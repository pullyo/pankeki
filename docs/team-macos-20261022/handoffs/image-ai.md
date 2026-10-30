# 이미지 AI 담당 인수인계 — 2026-10-22 KST

**역할·준비 상태.** SDXL 생성, 마스크 수정, 모델 preset·추론 엔진·품질을 담당한다. [현재 Mac 팀 기준](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/docs/TEAM-MACOS-20261022.ko.md>)에 따라 지정 소스와 기존 증거를 읽었으며 후속 배정에 착수할 준비가 됐다. 이번 확인은 파일 열람과 정적 추적이다. 아래 실행 수치·성공은 기존 검증 기록이며, 현재 서버 구동이나 모델 파일 무결성을 새로 확인한 결과가 아니다.

**현재 구현 — 이번에 소스로 확인.**

- [model_presets.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/pankeki/model_presets.py:7>): SDXL Base 기본값은 1024×1024, 25 steps, CFG 6, `dpmpp_2m/karras`, 수정 강도 0.55다. SD Turbo preset도 존재하지만 설치·실행 성공을 뜻하지 않는다. 설정의 checkpoint 이름·manifest SHA-256 형식을 검사하며, 모델 목록의 가용성 판단은 파일 존재 여부다.
- [server.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/pankeki/server.py:100>) → [engine.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/pankeki/engine.py:251>) → [workflows.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/pankeki/workflows.py:18>): 요청 검증·작업 큐를 거쳐 ComfyUI 생성/수정 그래프를 실행한다. 수정은 `VAEEncode`와 `SetLatentNoiseMask`로 원본 구조와 선택 영역을 전달한다. [composite.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/pankeki/composite.py:6>)는 원본 해상도에서 합성하고, 엔진은 원본 알파를 복원하며 마스크 밖 RGB 오차가 있으면 실패 처리한다. 빈 마스크는 추론 없이 원본을 반환한다.
- [comfy_adapter.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/pankeki/comfy_adapter.py:147>)는 history와 sampler 노드 5의 캐시 여부로 실제 denoiser 실행을 기록한다. `model_calls=1`만으로 실제 추론을 판정하지 않는다. [jobs.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/pankeki/jobs.py:85>)의 취소는 로컬 결과 폐기이며 GPU 실행은 계속될 수 있다.

**기능 성공 — 기존 Mac 검증 기록.**

- [restore-status.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/restore-status.json>)은 MPS의 SDXL Base 생성·마스크 수정 복원을 완료로 기록한다. [sdxl-integrity.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-integrity.json>)의 checkpoint는 6,938,078,334 bytes, SHA-256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b`로 검증됐다는 기록이다. 이전 모델 미복원 상태를 현재 상태로 사용하지 않는다.
- [generate-verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/generate-verification.json>): 생성 42.24초. [first-edit](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/first-edit-verification.json>)·[strength-090-edit](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/strength-090-edit-verification.json>)·[최종 edit](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/edit-verification.json>): 수정 28.16 / 30.17 / 28.16초, 모두 마스크 밖 RGB·알파 최대 오차 0, 최종 내부 변경 78,401 pixels. 모두 실제 denoiser 실행과 preview 25개를 기록한다. 해당 요청들은 cache off이며 unmanaged 서버의 exact cache 우회 사유를 기록한다. 시간은 클라이언트 관측값으로 GPU 전용 측정이나 성능 보장이 아니다.
- [real-generation-final.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/real-generation-final.json>): 최종 가시 입력창에서 SDXL 1024×1024 생성 26.25초, 실제 denoiser 실행·preview 25개·네 번째 후보 추가 성공. 사용자 설명과 스타일 문구가 요청에 함께 보존됐다는 기록이다.

**미확인·남은 문제.** 기능 성공과 정밀 수정 품질은 별도다. 복원 기록상 낮은 수정 강도에서는 기존 파란색이 남았고, 강도를 높이면 색과 형태가 함께 변했다. 색상만 정확히 교체하거나 재질·형태·캐릭터 정체성을 유지하는 품질은 보장되지 않는다. 이번에는 산출 이미지의 육안 재평가, 모델 재해시, 서버·MPS·설치 모델 상태를 확인하지 않았다. [최종 UI 검토](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/review.md:75>)는 수정 화면 연결을 확인했지만 해당 UI 단계에서 실제 마스크 추론과 실행 중 취소를 반복하지 않았다고 명시한다. SD Turbo, ROI 및 여러 입력에 대한 품질·성능은 이 검토로 입증되지 않는다.

**다음 작업 우선 3개 — 구체적인 후속 배정 후 수행.**

1. **마스크 수정 품질 기준 확정.** 완료 기준: 동일 원본·마스크·seed의 강도별 결과와 recipe를 개별 보존하고, 색상 변경·형태 유지·경계 품질을 구분해 평가한다. 마스크 밖 RGB·알파 오차 0과 시각적 품질 합격 여부를 각각 기록하고 총괄과 허용 범위를 정한다.
2. **최종 채팅 UI의 수정·취소 연결 검증.** 프론트·QA와 실행 순서를 조율한다. 완료 기준: 실제 마스크 수정 결과가 올바른 후보에 반영되고 원본·마스크·프로젝트가 보존되며, 취소·이전 revision의 결과와 preview가 현재 결과를 덮지 않는 증거를 남긴다. GPU 즉시 중단으로 표현하지 않는다.
3. **현 SDXL Mac 실행의 재현 자료 정리.** Mac 출시 담당과 조율한다. 완료 기준: 실제 모델 ID·checkpoint 무결성·MPS 상태·cache 정책과 요청별 recipe/metrics/result를 대응시켜 재현 절차 및 한계를 남긴다. 추가 모델 도입은 별도 배정으로 다룬다.

**변경 파일.** 이 문서 `docs/team-macos-20261022/handoffs/image-ai.md` 한 개만 작성했다. 제품 코드·공통 문서·다른 담당 파일 변경, 테스트·빌드·브라우저·추론·다운로드·서버 재시작·외부 게시·채팅 메시지 발송·추가 채팅/하위 에이전트 생성은 수행하지 않았다. 기존 로고·11개 메뉴·생성·마스크·프로젝트·모션·출력은 보존 대상이다.
