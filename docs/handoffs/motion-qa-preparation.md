# 2D 움직임 T9 독립 QA 준비

후속 실행 결과는 `motion-qa-results.md`와 `motion-renderer-pixel-qa.md`를 따른다. 아래는 착수 전 준비 당시의 기록이며 현재 실행 상태가 아니다.

2026-10-20 KST. [승인 실행계획 T9](../superpowers/plans/2026-10-20-motion-first-implementation.md)의 수용 목록을 준비했다. **구현 담당4명이 작업 중이며 QA는 아직 소스·빌드 검사, Node suite, 브라우저, 서버, 렌더/출력을 실행하지 않았다.** 실제 통합 QA는 아지가 source/build를 인계하고 다시 지시한 뒤 시작한다. 모델 비교는 총괄 검토 후 종료했고 추가 추론·seed는 없다.

## 착수 인계에 필요한 자료

- T1~8 담당의 최종 변경 파일·SHA256, API/DOM 계약 및 관련 검증 결과. 테스트 기준 시각과 source/build hash를 먼저 고정해 동시 수정과 구분한다.
- 실제 자체완결 `web/index.html`의 build hash, 확인할 origin, 현재 backend/SDK 가용 상태. 격리 정적 preview 증거와 실제 backend 통합 증거를 분리한다.
- 검증된 자체 제작 예제와 provenance, **예제와 다른 별도 사용자 준비 PNG 세트**의 실제 파일 경로·출처. 파일 선택 UI를 거쳐 같은 문서/렌더/출력 경로로 확인한다. 색 사각형 수치 fixture만으로 사용자 캐릭터 움직임 완료를 판정하지 않는다.
- 기대 project/rig/curve 자료와 export manifest 형식, 취소 UI 연결, 미지원/차단 안내. 승인 설계와 v2 계약이 다르면 최신 실행계획의 준비된 투명 분리 장면 규칙을 따른다.

## 실제 사용자 경로와 수용 목록

| 범위 | 인계 후 확인할 내용과 증거 |
| --- | --- |
| 실제 PNG 가져오기 | 예제와 별도 PNG를 UI에서 가져와 부위/부모/z순/배치·메시·기준 key를 편집한다. 원본/소재의 파일 bytes·SHA256/alpha를 전후 보존하고, 깨진 PNG·속인 크기/해시·한도 초과는 기존 작업을 유지한 채 실패해야 한다. 한 변1024 초과 v1 원본은 보존하고 변형만 차단한다. |
| 실제 변형 | `eyeOpen` 기본1, `mouthOpen/breath` 기본0. 각0/.5/1 및 복합 pose에서 실제 정점·픽셀이 중간 형태로 달라지는지 캡처한다. UV/연결은 불변이고 delta는 같은 base에 합산한다. 메시 아닌 다른 이미지 교체나 미리 만든 영상으로 통과시키지 않는다. |
| RGBA·삼각형 | 실제 Canvas에서 반투명 외곽·공유 삼각형 변·겹침·부모 opacity/z순을 확대 확인한다. 검은 선/틈·halo·원래 눈 중복이 없어야 한다. 원본 파일 불변과 렌더 합성 결과를 구분하고 alpha0의 숨은 RGB를 Canvas 재현과 혼동하지 않는다. |
| 준비/무효화·기하 오류 | 미준비 원본 위 덧그림은 차단한다. 모든 분리 부위가 준비됐다면 배경null의 투명 장면은 허용한다. source/material/mesh/key 교체의 stale rig·preset·motion, source mismatch를 차단한다. 개별 유효 key도 합성 시 뒤집힘/면적<0.0001px²이면 마지막 유효 화면을 유지하고 재생·출력을 중단해야 한다. |
| 재생·정지·undo | 눈/입/호흡·2초 loop·seek를 실제 렌더로 확인한다. 프레임마다 revision/undo가 늘지 않고 pause/save/한 drag는 한 commit/undo다. 숨김·화면 전환·문서 교체 후 이전 RAF/디코드/출력이 새 작업을 변경하지 않아야 한다. |
| 저장·재개 | 재생 중 저장은 보이던 pose를 정지/commit1회 후 v2로 저장한다. 닫고 새 브라우저 세션에서 가져오기/자동복원을 확인하고 정지 렌더·값·원본/부위/rig/curve가 같은지 대조한다. undo 스택은 재개되지 않고 그 사실을 표시한다. v1 후보/계보/선택 기록·원본 bytes를 보존하고 v2를 조용히 v1로 축소 저장하지 않는다. |
| PNG·48 ZIP | 정지 PNG와 미리보기 pose를 대조한다. ZIP을 writer와 독립적인 reader로 열어 CRC/중앙목록·manifest·실제 decode PNG48개를 확인한다. 이름0000..0047, `t=k/24 (k=0..47)`·duration2/fps24·canvas/rigHash 일치, 첫/중간/마지막 프레임의 실제 움직임과 alpha를 확인한다. t=2의49번째 프레임을 추가하지 않는다. |
| 취소·실패·상한 | 출력 중 UI 취소, 중간 프레임 실패, PNG합계128MiB 초과 때 완성 ZIP/부분 다운로드가 없어야 한다. 원문서와 현재값은 불변, 늦은 응답은 폐기한다. JSON64MiB·자산URL16MiB/디코드16MP·유일64개/RGBA합128MiB·16부위/정점256/삼각형512·curve32key·undo50/patch32MiB 경계를 관련 담당 증거와 실제 경로로 대조한다. |
| 성능 | 모델 실험 종료 상태에서 실제 장비·브라우저·viewport/DPR·canvas 크기·부위/정점/삼각형 수와 측정 방법/표본을 기록한다. 예제와 별도 PNG 장면의 미리보기30fps·입력100ms 목표를 실측하고 부하 조건별 값을 구분한다. 미달/미측정은 실제값·이유로 남기며 정적 스크린샷을 성능 통과로 세지 않는다. |

모델 편집의 ‘마스크 밖 픽셀0’ 지표를 움직여 위치가 바뀐 프레임 전체에 그대로 적용하지 않는다. 움직임은 불변 원본 자산·정해진 pose/합성·저장 왕복/미리보기와 출력의 일치가 기준이다. 새 이미지 생성 요청은0회여야 한다.

## 인계 후 실행 순서와 기록

1. source/build·실행 origin·입력 hash·기준 시각을 기록한 뒤 다음 관련 suite를 **한 번만** 통합 실행한다. 현재는 실행하지 않았다.

   ```powershell
   node --test scripts/test_character_document.cjs scripts/test_character_renderer.cjs scripts/test_character_motion.cjs scripts/test_character_export.cjs scripts/test_studio_state.cjs web/tests/profiles.test.cjs scripts/test_ui_state.cjs
   ```

2. 새 실제 브라우저 세션에서 예제와 별도 PNG의 가져오기→메시/key→0/.5/1→재생/정지/seek→undo→저장/닫기/재개→PNG/ZIP을 수행한다. 실제 browser pixels·다운로드 파일·수치로 확인하며 mock Node 성공과 분리한다.
3. 실패는 재현/기대값/기준 hash를 해당 구현 담당에게 인계하고 최소 수정 후 영향 범위만 다시 확인한다. QA가 담당 소스나 빌드를 임의 수정하지 않는다.
4. `work/team-resume/motion-qa/`에 report JSON·실장비 성능·스크린샷·PNG/ZIP 독립검증 결과를, `docs/handoffs/motion-qa-results.md`에 실제 완료/실패/미측정을 남긴다. 아지가 원본·재생 증거·프로젝트·ZIP을 직접 확인한 항목만 완료로 판단한다.

현재 준비의 변경은 이 문서와 모델 실험 종료 기록뿐이다. 새 조사·설치·모델/GPU 작업·광범위 테스트·새 채팅/에이전트는 없으며 **통합 source/build 인계 및 아지의 T9 착수 지시 대기**다.
