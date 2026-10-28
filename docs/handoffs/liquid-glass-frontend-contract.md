# Liquid Glass 복사본 — 프론트 표시 연결 요청

기존 QA8197/source/검수 증거는 동결한다. 디자인 작업은 `D:/Pankeki/work/design/liquid-glass-20261020/reflow/web/` 복사본이며 기존269bc88e… controller와7개 business JS를 그대로 소비한다. 디자인은 이 복사본의 template/CSS/build만 편집한다. 기존 모든 ID/data-action/입력/문서 경로는 유지한다.

총괄이 기존 프론트 담당에게 전달할 최소 요청은 **표시용 연결2개**다. 앱/문서/renderer/export/undo/hash 검증·저장 의미를 바꾸는 요청이 아니다. 새 의존성/프로젝트/모델/자동 리깅/가짜응답은 없다. 프론트는 이 별도 복사본 controller 또는 본인 staging에만 수정본·소비 기준/결과 SHA를 남기며 공유QA source를 바꾸지 않는다.

1. 기존 `motionPartList`의 실제 part 버튼에 `part.materialAssetId`의 검증된 asset PNG 썸네일을 넣는다. canonical list는 template에서 parts/motion 공통 왼쪽 패널로 이동하며 ID와 event delegation은 그대로다. 권장 자식은 `<img class="lg-part-thumb" alt="" aria-hidden="true">`와 `<span class="lg-part-name">실제 part.name</span>`. 원본 asset PNG로만 표시하고 source 그림의 임의 crop이나 예제 전용 CSS special case는 쓰지 않는다. 선택/키보드 동작은 기존 경로다.
2. 새 optional `<div id="motionTimeline" class="lg-motion-timeline" aria-label="현재 동작의 키프레임"></div>`에 실제 선택 동작의 curves를 읽기 전용으로 표시한다. row label은 실제 parameterId, key position은 `t/duration*100%`, 값/시각을 접근 가능한 text로 남긴다. CSS 계약은 `.lg-timeline-row` + `.lg-timeline-label` + `.lg-timeline-track` + `.lg-timeline-key`이며 key의 `style.left`가 실제%다. 표시 요소 자체에 새 편집/저장 명령을 연결하지 않는다. 이미 존재하는 seek slider가 조작을 담당한다. 현재 시간 커서는 container의 `--motion-position`에0..100%를 갱신하면 된다. optional node가 없으면 아무 일도 하지 않아 기존8197 UI에 영향이 없어야 한다. 동작/문서 변경 시 갱신하고 재생 프레임마다 전체 목록을 재구성하지 않는다.

디자인이 native stage/레이아웃/가독성 구현을 병행하므로 이 요청의 전달을 기다리며 제품 작업을 멈추지 않는다. 연결 전에는 실제 part.name과 기존 seek/곡선 표를 사용하며 가짜 썸네일·가짜 key diamond를 채우지 않는다. 정확한 변경본 전달 후 그 경로의 표시 영향만 검증한다.
