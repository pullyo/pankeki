# 색상 변경 — UX 수용 기준

2026-10-23 · 상태: **기준 작성 완료 / 최종 결과·화면 지정 대기**

목표는 원본의 형태를 유지하며 선택한 색만 바꾸는 것이다. 원본 픽셀 색상 변경을 기존 디자인 화면에 작게 연결하며, AI 부분 수정의 실행 성공과 구분해 판정한다.

## 직접 확인한 현재 근거

기존 [마스크 작업 화면](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/integration/ui-mask-before.png>)과 [수정 결과 화면](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/integration/ui-final-edit.png>)을 `view_image`로 확인했다. 로고·11개 메뉴, 원본/마스크와 디자인 미리보기 탭, 불러오기·저장, 큰 이미지 영역이 보인다. 이는 저장된 기존 캡처이며 새 색상 변경 UI의 검증 결과는 아니다.

기존 [원본](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/original.png>)과 [Base 0.99 실패 결과](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/result.png>)도 직접 비교했다. 빨강은 일부 생기지만 파랑이 남고 늘어진 천이 몸통층처럼 바뀐다. 색의 반영만으로 합격시키지 않는 이유다.

## 결과 이미지의 필수 조건

| 항목 | 수용 기준 |
| --- | --- |
| 지시색 | 선택 영역의 기준색과 유사한 색이 지정한 목표색으로 읽힌다. 명암을 보존하므로 모든 픽셀이 picker의 RGB와 같을 필요는 없다. 큰 원래 색 잔류나 대상 밖 색 변경은 미달이다. |
| 실루엣 | 이미지 크기·캐릭터 외곽·천의 방향/폭/길이·앞뒤 겹침이 원본과 같다. 이동·뒤틀림·새 형태 생성은 허용하지 않는다. |
| 주름·술·선 | 주름, 술 가닥, 윤곽선의 위치·두께·연결과 세부 결이 유지된다. 선이 사라지거나 뭉치고 가닥 수/배치가 바뀌면 미달이다. |
| 광택 | 원래 밝은 반사와 그림자의 위치·명암 대비가 유지된다. 단색 덮개, 하이라이트 소실, 포화로 인한 평면화는 미달이다. |
| 경계 | 선택 경계와 가는 술 끝에 색 번짐·후광·원래 색 테두리·계단 현상이 새로 생기지 않는다. 전체 보기와 원본 100% 크기에서 비교한다. |
| 주변 보존 | 얼굴·손·신발·몸통·배경 등 대상 밖 색과 형태가 유지된다. QA는 고정 마스크의 0 영역 RGB 최대 오차 0, 전체 alpha 최대 오차 0 및 색 범위에서 제외된 픽셀 보존을 별도로 확인한다. |

여섯 항목 모두 필수다. 색만 맞거나 주변만 보존된 결과는 채택하지 않는다. 불투명 스카프 한 사례의 통과를 반투명 경계·다색 소재·모든 캐릭터의 품질로 확장하지 않는다.

## 최소 UI와 과장 없는 문구

- 모드 선택은 **AI 부분 수정 / 색상 변경**. 색상 변경의 실행 버튼은 **색상 적용**, 완료 안내는 실제 결과가 있을 때 **색상을 적용했어요**로 한다. AI 생성으로 오인시키는 실행·로딩 문구를 쓰지 않는다.
- picker는 **바꿀 색**으로 이름과 HEX 값을 함께 표시한다. 원본 색은 **자동 / 직접 지정**, 직접 picker는 **기준 색**, 유사색 허용 정도는 **색 범위**와 좁게/넓게 방향으로 구분한다. 선택 상태는 색 외의 표시로도 드러나야 한다.
- 짧은 안내: **선택 영역에서 비슷한 색을 찾아 바꿉니다. 자동 추정이 맞지 않으면 기준 색과 색 범위를 조정하세요.** 자동을 물체 인식·완벽한 선택으로 약속하지 않는다. 검정/흰 반사·무채색·여러 비슷한 색이 섞인 영역은 추정 한계가 있다.
- 선택 영역이나 일치 색이 없으면 적용 성공으로 표시하지 않고 **선택 영역과 기준 색을 확인해 주세요**라고 안내한다. 변경 없음도 성공적인 색 변경으로 세지 않는다.
- 기존 디자인 화면 안에서 작은 컨트롤로 유지해 이미지·마스크 작업을 가리지 않는다. 원본/마스크·미리보기·저장 흐름과 로고, 홈/프로젝트/이미지 생성/디자인/부위 편집/표정 · 동작/출력/갤러리/템플릿/모델 관리/설정의 11개 메뉴를 보존한다. 새 화면에서 실제 노출과 순서를 다시 확인한다.

## 다음 검토 자료와 현재 한계

총괄이 최종 지정하는 `runtime/macos/recolor-quality/ai/` 결과와 integration 실제 스크린샷을 기다린다. 원본·마스크·기준색 자동/직접 설정·목표색·색 범위·결과를 대응시켜 위 여섯 항목을 전후 비교하고, 화면에서 모드/버튼/값/안내·로고·11개 메뉴를 확인한다. 스크린샷만으로 키보드 동작이나 픽셀/알파 일치를 검증했다고 주장하지 않는다.

이번에는 기준만 작성했다. 새 색상 변경 결과와 UI는 아직 수용 판정하지 않았다. GPU·API·브라우저·제품 소스 열람/수정 없이 기존 이미지 확인과 이 문서 작성만 수행했다.

변경 파일: `docs/team-macos-20261022/recolor/ux.md` 한 개.

## 2026-10-23 실제 알고리즘 결과 평가

**최신 판정: 이 RGB 스카프 사례의 알고리즘 후보로 OKLab을 수용한다. HSV보다 목표 빨강과 원래 명암의 구분이 잘 유지된다. 앱 통합·최종 UI 수용은 대기한다.** 모든 색·마스크·투명 소재를 통과했다는 의미는 아니다.

### 직접 확인한 비교 조건

[원본](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/original.png>)·[마스크](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/mask.png>), [HSV 후보](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/candidate-hsv.png>)·[OKLab 후보](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/candidate-oklab.png>)를 `view_image(detail="original")`로 원본 1024×1024 크기에서 직접 비교했다. [method-comparison.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/method-comparison.json>)의 파일 해시와 실제 파일도 대조했다.

- 목표 `#FF0000`, 원래 색 자동 추정, tolerance 35, feather 4로 고정되어 있다. 공통 추정색은 `#3B8CC3`다.
- 원본 해시 `604aa7eb…1819`, 마스크 `7d105bec…2481`, HSV `c0dd3231…8473`, OKLab `c057fd2d…822f`다. 두 후보는 같은 원본/마스크와 색 선택 조건을 사용한다.
- 원본·후보는 모두 1024×1024 RGB다. 비교 JSON의 `resampling=false`, `inference_calls=0`은 기존 기록이며, 이번 UX 담당이 알고리즘이나 추론을 새로 실행한 것은 아니다.

### 여섯 항목의 육안 판정

| 항목 | HSV | OKLab |
| --- | --- | --- |
| 지시색 | 빨강으로 읽히지만 더 탁하고 어두운 붉은색이다. | 지정한 선명한 빨강에 더 가깝다. 천의 큰 면에 기존 파란 덩어리가 남지 않는다. |
| 실루엣 | 캐릭터 외곽과 목 감김·늘어진 천의 방향/폭/길이가 유지되어 보인다. | 같은 형태가 유지되어 보인다. 이전 생성 결과처럼 천을 몸통층으로 바꾸지 않는다. |
| 주름·술·선 | 주름, 긴 하이라이트, 술 가닥의 위치·연결이 원본과 대응한다. | 같은 위치·연결이 유지되고, 작은 술과 선도 다시 그려진 흔적 없이 대응한다. |
| 광택 | 반사는 남지만 전체 명암이 더 내려가 원래의 밝은 천보다 무거워 보인다. 부분 충족으로 보아 우선 후보로 선택하지 않는다. | 왼쪽 목의 밝은 곡선 반사·세로 천의 긴 반사·주름 그림자가 구별된다. 단색 덮개로 평면화되지 않았다. 이 샘플의 시각 기준은 충족하나 명도가 수치까지 완전히 같다는 뜻은 아니다. |
| 경계 | 선택 부위 밖으로 큰 번짐이나 새 실루엣은 보이지 않는다. | 목/몸통 접촉부와 술 끝에서 새 형태·큰 후광·색 번짐은 보이지 않는다. 기존 어두운 윤곽선과 선택에서 제외된 색은 남는다는 한계가 있다. |
| 주변 보존 | 얼굴·몸통·팔·장갑·다리·신발·배경이 유지되어 보인다. | 같은 주변 요소가 유지되어 보인다. 픽셀 오차 0은 아래 기존 측정 기록과 구분한다. |

**100%에서의 선·잔류색 확인:** OKLab의 목 왼쪽 `(390,560)`은 원본 `(56,147,200)`에서 `(243,0,0)`, 오른쪽 주름 `(645,580)`은 `(21,89,158)`에서 `(160,0,0)`으로 바뀌었다. 세로 반사 부근 `(590,675)`은 `(72,178,233)`에서 `(255,103,86)`으로 바뀌어 반사에 맞는 밝은 붉은색이 남는다. 목표색 picker와 모든 픽셀의 RGB가 같아야 한다고 보지 않는다.

반면 마스크 안의 어두운 선 `(500,527)`은 `(25,23,47)` 그대로다. 이 남색 선을 큰 파란 천 잔류나 새 후광과 혼동하지 않는다. 원래 선·마스크 밖·색 범위 제외 픽셀까지 전부 빨강으로 만들었다고 표현하지 않는다. 잔류색이 거슬리는 다른 마스크에서는 기준색/색 범위 조정 후 다시 봐야 한다.

기존 비교 JSON은 두 방법 모두 마스크 밖/색 범위 제외 RGB 최대 오차 0을 기록한다. 분석 영역의 `lightness_rank_pearson`은 HSV 0.9827 / OKLab 0.9994, 평균 절대 OKLab L 변화는 0.0580 / 0.0213이다. 이 수치는 기존 계산을 인용한 것으로, 이번에 독립 재계산하지 않았다. 육안의 명암 보존 판단을 보조하며 전체 앱 품질 점수나 완전한 광택 보존의 증명은 아니다. 서로 다른 코드 구간의 시간으로 속도 우열도 매기지 않는다.

### 준비된 추가 결과와 로컬 실행 기록

추가 결과는 아래 실제 PNG를 직접 보았다. 각 `results/<색>/`의 원본·결과·recipe·recolor-params·metrics를 읽고, metrics가 가리키는 `local-engine/runtime/runs/<job_id>/result.png`와 복사본의 바이트/해시 일치도 확인했다. 이는 로컬 Engine 실행 자료이며 실제 앱 HTTP·브라우저·저장 UI 검증으로 세지 않는다.

| 준비된 사례 | 실제 관찰과 판정 범위 |
| --- | --- |
| [red/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/red/result.png>) | 위 OKLab 후보와 같은 파일 해시다. 로컬 job `55f04a7cf0c44842a90e247180d16433`의 결과와 일치한다. RGB 빨강 사례의 후보 수용 근거다. |
| [green/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/green/result.png>) | 초록으로 읽히며 주름·술·선 위치를 유지한다. 매우 선명한 초록이므로 채도/반사 표현을 모든 색의 자연스러움으로 일반화하지 않는다. 추가 색의 긍정 근거로만 기록한다. |
| [white/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/white/result.png>) | 흰 천과 회색 주름이 구분되고 형태는 유지된다. 100%에서 작은 청록 기운/가는 선이 남아 보이는 지점은 선택 제외 색·기존 선과 구분할 추가 검수 대상이다. 완전한 중성 흰색 처리로 일괄 합격시키지 않는다. |
| [black/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/black/result.png>) | 검정 천과 밝은 반사는 구분되나 어두운 주름의 대비가 낮다. 형태 보존은 긍정적이지만 검정에서도 원래 가독성을 완전히 보존한다고 약속하지 않는다. 어두운 면의 세부 검수는 남긴다. |
| RGBA 빨강 [원본](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/rgba-red/original.png>) / [결과](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/rgba-red/result.png>) | 빨강과 주름·술 위치는 유지되어 보인다. 이 보기에서는 대각선 밝기 차가 보여 투명 합성의 최종 시각 판정은 보류한다. 아래 알파 확인과 분리하며 새 선을 생성했다고 단정하지 않는다. |

**RGBA를 직접 읽어 확인한 범위:** 이 원본의 RGB는 불투명 원본과 같고 알파만 다르다. 알파 범위 0–255, 완전 투명 321픽셀, 부분 투명 81,864픽셀이며 결과의 전체 알파 배열은 원본과 정확히 같다. 예를 들어 `(590,690)`의 원본/결과 `(71,173,231,0)`도 같다. 이는 투명 픽셀의 색 보존 근거이고, 다양한 실제 투명 캐릭터의 외곽 검증은 아니다. 대각선 투명도 변화가 있는 이 파생 샘플의 보기를 여러 합성 배경에서 확인하기 전까지 투명 경계 완성도를 확정하지 않는다.

추가 8개 로컬 job의 기존 metrics는 `kind=local_recolor`, `model_calls=0`, `model_used=false`이며 마스크 밖 RGB/전체 alpha 최대 오차 0을 기록한다. 이 오차값은 기존 실행 기록의 인용이다. 직접 확인한 알파 배열 일치, 파일 해시 일치와 같은 범위로 혼용하지 않는다.

변경 없음 사례도 확인했다. `noop-empty`는 `empty-mask`, `noop-no-match`는 `no-matching-color`, `noop-same`은 `same-color`이며 세 원본/결과의 픽셀 배열이 각각 같다. job의 `state=succeeded`만으로 실제 색이 적용됐다고 표시하면 안 된다. 새 UI에서 각 이유와 변경 없음 안내가 나타나는지는 이후 실제 캡처/동작 검수로 남긴다.

### 현재 수용 범위와 다음 확인

이번 수용은 고정 RGB 빨강 사례에서 OKLab을 선택하는 알고리즘 시각 판정이다. 흰색/검정의 세부와 RGBA 합성 보기는 한계를 남겼다. 실제 UI의 모드·picker·자동/직접·색 범위·버튼/상태 문구, 로고·11개 메뉴, 실제 적용·저장 흐름은 통합 후 총괄이 지정하는 증거로 확인한다. 아직 앱 통합 완료나 제품 전체 수용을 주장하지 않는다.

이번 수정은 이 문서의 후속 평가 추가뿐이다. GPU·API·브라우저·제품 소스는 사용하거나 수정하지 않았다. 실제 PNG와 기존 JSON, 이미지 픽셀의 읽기 전용 확인만 수행했다.

## 2026-10-23 최종 UI·앱 빨강 결과 수용

**최신 판정: 1440×900의 활성 색상 변경 UI와 해당 RGB 빨강 적용 결과를 수용한다. 저장 링크의 PNG 데이터 연결도 수용한다. 네이티브 파일 저장 완료는 미확인으로 남긴다.** 흰색·검정·투명 합성의 앞선 한계는 그대로 유지한다.

### 실제 확인한 자료와 실행 대응

[최종 UI 1440×900](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-result-1440.jpg>), [이전 원본/마스크 화면 1280×720](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-mask-before.jpg>), [DOM 저장 링크 결과 PNG](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-dom-link-result.png>)와 [동일 원본](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/original.png>)을 `view_image(detail="original")`로 직접 보았다. 색·형태·경계의 세부 비교는 JPEG 화면의 축소 미리보기 대신 실제 1024×1024 PNG로 수행했다.

[ui-api-run.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-api-run.json>), [ui-pixel-proof.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-pixel-proof.json>)과 실제 [job recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/422683208182457693da00d28936a767/recipe.json>)·[색상 설정](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/422683208182457693da00d28936a767/recolor-params.json>)을 대조했다.

- 실제 앱 job: `422683208182457693da00d28936a767`. `request_operation=recolor`, `kind=local_recolor`, `status=succeeded`, `skipped=null`, `model_calls=0`이다. 이는 기존 앱 실행 기록의 확인이며 UX 담당이 새 API/브라우저 조작을 수행한 것은 아니다.
- 목표 `#E3342F`, 기준색 자동(`source_color=null`, 추정 `#3B8CC3`), tolerance 35, feather 4, `oklab-recolor-v1`이다. 화면의 `#e3342f`·자동·35와 일치한다. 앞의 알고리즘 비교 목표 `#FF0000`과는 다른 설정이므로 그 후보와 동일 픽셀 결과로 취급하지 않는다.
- 해당 run의 실제 원본/마스크 해시는 앞선 `604aa7eb…1819` / `7d105bec…2481`과 같다. UI 링크 PNG와 run 결과는 모두 1024×1024 RGB다.

### 최종 UI 판정

- **설정과 실행 문구 수용:** 작업의 활성 값은 색상 변경, picker는 바꿀 색과 HEX 값, 기준 색은 자동, 색 범위는 좁게/넓게와 값 35로 표시된다. 기준색과 목표색이 구분된다. 실행은 색상 적용, 보조 문구는 선택 영역에 색상 적용이며 완료 상태는 색상 적용 완료다. 실제 변경 job과 연결되어 있어 색상 적용을 AI 생성 성공으로 오인시키지 않는다.
- **자동 한계 안내 수용:** 선택 영역의 비슷한 색을 바꾸며 자동 추정이 맞지 않으면 기준 색과 색 범위를 조정하라는 짧은 안내가 보인다. 완벽한 물체 선택이나 모든 색 변경을 약속하지 않는다.
- **배치 수용:** 이 1440×900 캡처에서 이미지·술 끝·설정·주 실행 버튼이 가려지거나 서로 겹치지 않는다. 컨트롤은 작은 한 줄이며 상시 오른쪽 패널을 만들지 않았다. 원본/마스크·디자인 미리보기 탭, 불러오기·이미지 저장 진입점도 남아 있다.
- **브랜드·탐색 보존 수용:** 기존 팬케이크 로고/Pankeki 표기와 홈, 프로젝트, 이미지 생성, 디자인, 부위 편집, 표정 · 동작, 출력, 갤러리, 템플릿, 모델 관리, 설정의 11개 메뉴가 유지된다. 디자인의 선택 표시와 현재 작업 제목도 일치한다.

이전 1280×720 캡처와 최종 캡처는 viewport와 탭 상태가 다르므로 미리보기의 화면상 크기 차이를 원본 형태 변화로 세지 않았다. 이전 캡처 하단에는 유효성 오류 문구가 남아 있지만 최종 캡처에는 없고 해당 job은 성공 기록이다. 이 시점 차이를 현재 실패나 오류 원인의 증거로 확장하지 않는다.

접힌 작업/기준색 선택지 전체, 직접 지정 상태, 키보드 이동·고배율 흐름은 이 정지 화면만으로 모두 검증했다고 주장하지 않는다. 이번 UI 수용은 제출된 1440×900의 활성 색상 변경 상태에 한정한다.

### 실제 빨강 PNG의 여섯 항목 판정

| 항목 | 해당 앱 결과의 판정 |
| --- | --- |
| 지시색 | **수용.** 스카프의 큰 면이 선택한 붉은색 계열로 읽힌다. 밝은 반사와 어두운 주름도 붉은 천으로 이어지며, 큰 파란 천 덩어리가 남지 않는다. 모든 픽셀을 picker RGB로 평탄화한 결과가 아니다. |
| 실루엣 | **수용.** 원본 캐릭터 외곽, 목 감김, 비스듬한 천 끝의 방향·폭·길이와 겹침이 유지되어 보인다. |
| 주름·술·선 | **수용.** 원래 주름과 술 가닥·윤곽선이 같은 위치에서 연결된다. 이전 생성 실패처럼 천을 몸통층으로 바꾸거나 술을 재구성한 흔적은 보이지 않는다. |
| 광택 | **수용.** 목 왼쪽의 곡선 반사, 세로 천의 긴 반사, 주름 그림자가 구분된다. 반사의 위치가 남아 있고 단색 덮개가 되지 않았다. 완전히 동일한 수치 명암을 보장하는 판정은 아니다. |
| 경계 | **수용(이 원본/마스크).** 100% PNG에서 목/몸통 접촉부와 술 끝에 새 실루엣·큰 번짐·후광은 보이지 않는다. 앞서 구분한 기존 어두운 선과 선택 제외 색까지 모두 제거되었다고 주장하지 않는다. |
| 주변 보존 | **수용.** 얼굴·몸통·팔/장갑·다리/신발·배경이 유지되어 보인다. 아래 픽셀 보존 수치는 별도의 총괄 검증 기록이다. |

### PNG 데이터 연결과 파일 저장 완료의 구분

총괄의 `ui-pixel-proof.json`은 `ui_link_matches_server_png_bytes=true`, 마스크 밖 RGB 최대 오차 0, alpha 최대 오차 0, 선택 안 변경 63,761픽셀을 기록한다. DOM 저장 링크의 전체 PNG를 bounded chunks로 읽어 서버 PNG와 비교했다는 총괄의 검증 범위로 인용하며, UX가 브라우저에서 해당 절차를 재실행했다고 표현하지 않는다.

UX는 제공된 PNG의 실제 SHA-256이 아래 값과 일치하고, 해당 run의 [result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/422683208182457693da00d28936a767/result.png>)와 파일 바이트가 완전히 같은 것을 로컬 읽기로 별도 확인했다.

`7847ebc19802f5fabb298f7964670c09fc0f16cacbcc0e6a1f97243ac4551854`

따라서 **UI 저장 링크가 올바른 전체 결과 PNG로 연결된 범위는 수용**한다. 총괄 보고상 네이티브 다운로드 완료 이벤트는 내장 브라우저에서 두 번 timeout했고, proof의 scope도 native filesystem download completion을 관찰하지 못했다고 명시한다. **다운로드 폴더에 실제 파일 저장이 완료됐다는 판정은 하지 않는다.**

### 최종 범위와 잔여 항목

해당 RGB 빨강 적용·제출된 최종 UI·결과 PNG 연결의 수용을 마쳤다. 네이티브 파일 저장 완료, 앞서 남긴 흰색/검정의 세부 표현과 RGBA의 합성 배경별 시각 검수는 잔여 항목으로 유지한다. 색상 변경 전체를 모든 입력에서 검증 완료했다고 확장하지 않는다.

이번 변경은 이 문서에 최종 판정을 덧붙인 것뿐이다. 제품 코드·다른 담당 파일을 변경하지 않았으며 GPU·API·브라우저는 사용하지 않았다.

## 2026-10-23 추가 — 네이티브 PNG 저장 확인

**이전의 네이티브 파일 저장 미확인은 해소되었다.** 갱신된 [ui-pixel-proof.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-pixel-proof.json>)은 실제 다운로드 완료와 서버 PNG 바이트 일치를 기록하며, 서버·저장 프로젝트·DOM 링크·다운로드 PNG 전체가 같다고 명시한다. UX도 제공된 [ui-native-downloaded.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-native-downloaded.png>)와 DOM PNG·해당 run 결과의 바이트가 완전히 같고 SHA-256이 앞선 `7847ebc1…1854`와 일치함을 로컬 읽기로 확인했다. 저장 프로젝트까지의 일치는 총괄 검증 기록을 인용한다.

[최종 비교 화면 1440×900](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-compare-final-1440.jpg>)을 직접 확인했다. 원본과 빨강 결과가 함께 보이며 불필요한 생성 스타일 선택부가 없다. [ui-checks.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-checks.json>)의 `finalCompare`도 `styleHidden=true`, 1440×900, 11개 메뉴와 두 1024×1024 이미지를 기록한다. 기존 빨강/UI 수용을 유지하고 실제 PNG 다운로드의 수용 근거를 추가한다. 앞의 두 timeout은 이전 시점의 기록이며 현재 미확인 항목으로 남기지 않는다.

흰색·검정·투명 합성의 기존 잔여 한계는 유지한다. 이번에는 이 짧은 추가만 작성했으며 제품 코드 변경이나 브라우저·GPU 조작은 하지 않았다.
