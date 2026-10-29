# ComfyUI에서 Pankeki로 옮길 원리와 적용안

2026-10-20 KST · 로컬 고정 소스 분석 · 구현 전 제안

기준은 `vendor/ComfyUI` HEAD **`8f04fd6ecf4a548937971e840af2a985529fab76`**다. 아래 ComfyUI 핵심 5개 파일은 해당 commit 대비 작업 트리 변경이 없다. Pankeki 3개 파일과 대조했으며 GPU·다운로드·테스트 재실행은 하지 않았다.

| 원리 | 실제 소스·함수와 의미 |
| --- | --- |
| 입력과 의존성에 따른 변경 감지 | [caching.py](../../../vendor/ComfyUI/comfy_execution/caching.py)의 `CacheKeySetInputSignature.get_node_signature/get_immediate_node_signature`는 노드 종류·입력 상수·연결 출력 슬롯·상위 노드 서명을 묶는다. [execution.py](../../../vendor/ComfyUI/execution.py)의 `IsChangedCache.get`은 `fingerprint_inputs`/`IS_CHANGED`를 반영한다. [nodes.py](../../../vendor/ComfyUI/nodes.py)의 `LoadImage.IS_CHANGED`는 파일 내용의 SHA256을 반환한다. 같은 파일명도 내용이 바뀌면 이전 결과를 그대로 쓰지 않는 구조다. |
| 필요한 출력부터 의존성을 따라 실행 | [graph.py](../../../vendor/ComfyUI/comfy_execution/graph.py)의 `TopologicalSort.add_node`는 필요한 상위 노드를 모으고 캐시가 있는 상위 계산은 실행 목록에서 제외한다. `ExecutionList.stage_node_execution`은 의존성이 준비된 노드를 고른다. `PromptExecutor.execute_async`는 출력 노드에서 시작하고 `execution_cached`를 보고한다. seed만 바꾸면 sampler 이후 계산이 달라지고, 유효한 상위 결과는 재사용될 수 있다. |
| 실행 상태와 결과 재사용을 구분 | [progress.py](../../../vendor/ComfyUI/comfy_execution/progress.py)의 `ProgressRegistry.start_progress/update_progress/finish_progress`와 `WebUIProgressHandler._send_progress_state`는 `prompt_id`·노드별 `state/value/max`를 전달한다. `execution.py`의 `execute`는 캐시 결과에서도 진행 완료를 표시하므로, 완료 노드 수를 새 GPU 계산량으로 해석하면 안 된다. |

**현재 Pankeki와의 경계.** 공식 SDK 제출, 모델·소스 검증을 포함한 완성 PNG 캐시, 선택적 ROI, 마스크 밖 RGB/알파 보존은 이미 구현되어 있다. ComfyUI 노드 캐시는 중간 결과 재사용이고, ROI는 처리할 이미지 영역 축소이므로 서로 다르다. [engine.py](../../../pankeki/engine.py)의 `Engine.__call__/_dependencies`는 `feather`까지 recipe에 넣어 최종 결과 캐시를 구분하고, 추론 후 `generated-crop.png`를 저장해 합성한다. [metrics.py](../../../pankeki/metrics.py)의 `EventMetrics.feed`는 작업 ID별 이벤트를 관찰한다. [jobs.py](../../../pankeki/jobs.py)의 `JobManager._public`은 작업 상태·revision·미리보기를 제공하지만 노드 단계 진행 필드는 없다.

**적용안 1 — 부분 수정 결과의 경계만 다시 조절하기.**

- 사용자 효과: 마음에 드는 편집 결과에서 경계 부드러움만 바꿀 때, 검증된 기존 추론 결과로 즉시 다시 합성한다.
- 필요 변경: `engine.py`에서 추론 입력의 서명과 최종 합성 설정을 분리한다. 저장 raw와 원본·마스크·모델·코드·workflow·ROI 좌표의 일치를 확인한 경우에만 `feather` 재합성을 허용한다. 원본 해상도·알파 보존과 캐시 삭제/용량 정책도 유지한다.
- 한계: 현재는 `feather` 변경이 Pankeki의 완성 결과 캐시를 바꾼다. ComfyUI가 sampler를 재사용할 가능성은 있지만 캐시 생존을 보장하지 않는다. 제안은 그 경우도 앱에서 명시적으로 처리하려는 것이며, 잘못 생성된 장갑 색이나 가방 재질을 개선하지는 않는다.

**적용안 2 — 후보마다 실제 작업 단계를 보여주기.**

- 사용자 효과: 후보 카드에 ‘원본 준비 → 이미지 생성(현재 step) → 원본 보존 합성 → 완료’를 보여주고, 결과 재사용은 별도 표시한다. 정지한 것처럼 보이는 대기와 실제 오류를 구분하기 쉬워진다.
- 필요 변경: SDK가 전달하는 이벤트를 확인한 뒤 고정 workflow의 노드를 제품 단계로 매핑한다. 백엔드 job의 `prompt_id/revision`에 단계와 step을 묶고 프론트엔드 담당이 표시한다. 늦은 이벤트는 기존 revision 검사로 제외한다.
- 한계: step 비율은 전체 소요시간 비율이 아니다. SDK 경로에서 빠진 이벤트는 ‘진행 정보 없음’으로 처리하고, 실제 결과 저장 전 완료를 표시하지 않는다. `execution_cached`와 SDK 성공만으로 새 sampler 실행을 단정하지 않는다.

우선순위는 **2번의 전달 가능 이벤트 확인 후 단계 표시**, 다음은 **1번의 합성 전용 재조정**이다. 구현 범위는 별도 결정하며, 이번 분석은 속도·화질 개선을 실측한 결과가 아니다.
