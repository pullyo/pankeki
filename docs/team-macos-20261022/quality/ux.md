# 부분 수정 품질 — UX baseline과 후보 수용 기준

기준일: 2026-10-22 · 담당: 사용 흐름·디자인 시스템·접근성  
진행 상태: **1차 평가 완료 · 개선 후보 지정 대기**  
배정: [quality-sprint.md](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/docs/team-macos-20261022/quality-sprint.md>)  
프로젝트: `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki`

**판정: 기존 세 수정 결과 모두 품질 수용 기준 미달이다.** 빨강 지시를 놓치거나, 색을 바꾸면서 스카프의 형태·겹침 관계를 훼손한다. 기존 실행 성공·마스크 밖 보존 기록과 이미지 품질 판정을 구분한다. 이번에 개선 후보를 생성하거나 검토한 것은 아니다.

## 1. 이번에 직접 확인한 근거

`view_image`로 기존 원본·마스크 2개·수정 결과 3개를 열람했다. 파일의 크기/모드, SHA-256, 마스크 범위도 읽어 대응을 확인했다. 이미지 편집·새 생성·브라우저·detector·외부 조사·제품 코드 변경은 수행하지 않았다.

- 원본: [generated.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/generated.png>). 크림 배경의 팬케이크 마스코트이며 큰 눈·미소·든 팔·파란 장갑/신발과 파란 스카프가 있다. 스카프는 목을 감은 띠와 아래로 늘어진 천·술로 구성된다. 원본 생성 job은 `49462ad33883400c90ce4f90c74c474f`, seed는 `20261022`다.
- 선택 영역: [edit-mask.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/edit-mask.png>)와 [scarf-mask.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/scarf-mask.png>)는 파일 해시가 같다. 1024×1024 L 마스크, 흰색 78,410픽셀, 0/255 이진값이며 흰 선택 영역의 경계 상자는 `(300,496)–(732,859)`(우측·하단 제외)다. 목과 늘어진 천을 따라 대략 선택한 다각형이다. 뒤의 판정은 선택된 천을 대상으로 하며, 선택 밖 파란 부분의 보존을 지시 실패로 세지 않는다.
- 세 run의 `original.png`는 위 원본과, `mask.png`는 위 마스크와 각각 SHA-256이 일치한다. 아래 복사본도 각 run의 `result.png` 및 기존 verification의 `metrics.image_sha256`과 일치한다. 모든 열람 결과는 1024×1024 RGB 이미지다.

| 구분 | 직접 본 수정 결과 | 실제 run / 설정 근거 | 편집 조건과 요청 핵심 |
| --- | --- | --- | --- |
| B0: 최초 수정 | [first-edited.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/first-edited.png>) | `f172dcbfe7284f25b4db6a8b6c530081` · [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/f172dcbfe7284f25b4db6a8b6c530081/recipe.json>) · [workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/f172dcbfe7284f25b4db6a8b6c530081/workflow.json>) | denoise 0.65. 마스코트 전체 설명에 `bright red fabric scarf`를 포함. negative는 빈 문자열. |
| B1: 강한 빨강 지정 | [edited.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/edited.png>) | `3a9a661a82a84622ab6ef61cc13986d0` · [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/3a9a661a82a84622ab6ef61cc13986d0/recipe.json>) · [workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/3a9a661a82a84622ab6ef61cc13986d0/workflow.json>) | denoise 1.0. `vivid bright red wool scarf`와 빨간 주름/술/천을 반복. negative: `blue, cyan, green, purple, blue scarf, photograph`. |
| B2: 가중치·0.90 | [strength-090-edited.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/strength-090-edited.png>) | `0525a0d4c9b9489fabfc80f6b5d8f704` · [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/0525a0d4c9b9489fabfc80f6b5d8f704/recipe.json>) · [workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/0525a0d4c9b9489fabfc80f6b5d8f704/workflow.json>) | denoise 0.90, `(bright red fabric scarf:1.5)`와 `red neck scarf`. negative: `blue scarf, cyan fabric, blue neck scarf`. |

공통 편집 조건은 SDXL Base(`sd_xl_base_1.0.safetensors`), seed `20261023`, 25 steps, CFG 6.0, `dpmpp_2m`/`karras`, 1024×1024, ROI false, recipe feather 4다. prompt·negative·sampler 입력은 각 workflow에서도 확인했다. 전체 문구는 연결한 recipe/workflow를 기준으로 한다. **세 결과는 prompt·negative·denoise가 동시에 달라진 기존 관찰군**으로, 이 자료만으로 특정 변수의 개선 효과를 단정하지 않는다.

추적상 주의: `first-edit-verification.json`과 `strength-090-edit-verification.json`의 최상위 `file`도 `edited.png`를 가리킨다. 그 경로만으로 이미지를 대응하면 결과를 혼동한다. job ID·run 경로·실제 이미지 해시로 구분했다. 원본 해시는 `604aa7eb…1819`, 공통 마스크는 `7d105bec…2481`, B0/B1/B2 결과는 각각 `e4f521c0…398e` / `0e2739b1…174e` / `f17ca721…4d4e`다.

## 2. 직접 본 이미지의 네 가지 품질 판정

판정어는 **충족 / 일부 충족 / 미충족 / 판단 유보**다. 색만 바꾸는 목표를 기준으로 보며, 요청된 빨강 자체를 캐릭터 특징 손실로 감점하지 않는다.

| 기준 | B0: 최초 수정 | B1: 강한 빨강 지정 | B2: 가중치·0.90 |
| --- | --- | --- | --- |
| 지시 반영 | **미충족.** 선택된 스카프가 여전히 파랗다. 밝은 빨강 천으로 읽히지 않는다. | **일부 충족.** 중앙과 아래쪽은 선명한 빨강이지만, 목 양쪽에 큰 파란 고리 모양이 남아 한 벌의 빨간 스카프로 읽히지 않는다. | **미충족.** 목과 늘어진 천의 주색은 여전히 파랑이다. 좁은 빨간 무늬·측면·하단 조각만 생겼다. |
| 의도치 않은 형태 변화 억제 | **일부 충족.** 목 감김과 세로 천의 큰 방향은 유지하지만 주름과 술의 배치가 달라진다. | **미충족.** 스카프가 대각선 삼각 천과 파란 고리로 재구성된다. 늘어진 부분을 갈색 팬케이크 띠처럼 보이는 형태가 가로지른다. | **미충족.** 세로 천은 남지만 하단에 갈색 띠와 별도 빨간 천 조각이 끼며 원래의 연속된 천·술 관계가 깨진다. |
| 경계·재질의 자연스러움 | **일부 충족.** 큰 명암·굵은 선은 이어지나 술 끝 선이 더 얽히고 잘게 갈라진다. 빨강 천의 재질 적합성은 지시가 실패해 판단할 수 없다. | **미충족.** 파란 고리·빨간 천·갈색 띠의 겹침이 불명확하고 하단에 잘린 조각처럼 보이는 접합부가 생긴다. 빨간 면적 증가만으로 천의 완성도가 확보되지 않는다. | **미충족.** 파란 천 위의 빨간 선과 하단 직선형 빨간 면이 자연스러운 주름/음영으로 연결되지 않는다. 경계의 색·형태 단절이 보인다. |
| 캐릭터 특징 유지 | **충족(이 샘플의 가시 주요 특징).** 눈·미소·몸의 큰 실루엣·팔/다리·배경은 원본과 같게 보인다. | **일부 충족.** 얼굴·포즈·팔다리는 유지되지만 몸통과 스카프가 만나는 구조와 의상의 실루엣이 바뀐다. | **일부 충족.** 얼굴·포즈·팔다리는 유지되지만 하단 몸통/스카프의 겹침과 끝 모양이 달라진다. |

마스크를 같은 좌표로 읽어 B1의 파란 고리 위치 `(390,560)`, `(645,580)`와 B2의 파란 세로 천 위치 `(590,675)`가 모두 흰색 선택 영역임을 확인했다. 따라서 위의 큰 파란 잔류를 단순한 선택 밖 원본 보존으로 설명할 수는 없다. 원인 자체는 이 육안 평가로 확정하지 않는다.

**수용 결론:** B0는 핵심 색 변경 실패, B1은 부분 반영과 구조 손상, B2는 색 변경 실패와 접합부 손상으로 모두 미수용한다. B1의 빨간 면적이 더 넓다는 관찰을 전체 품질 향상이나 채택 근거로 사용하지 않는다.

## 3. 기존 실행·픽셀 기록에서 인용한 내용

[first-edit-verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/first-edit-verification.json>), [edit-verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/edit-verification.json>), [strength-090-edit-verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/strength-090-edit-verification.json>)은 모두 `state: passed`, `real_comfyui`, `denoiser_executed: true`, `cache: off`를 기록한다. 해당 실행을 이번에 다시 수행하지 않았다.

| 기존 기록 | B0 | B1 | B2 |
| --- | --- | --- | --- |
| elapsed_s | 28.16초 | 28.16초 | 30.17초 |
| 마스크 밖 최대 오차 / alpha 최대 오차 | 0 / 0 | 0 / 0 | 0 / 0 |
| 선택 안 변경 픽셀 | 78,395 | 78,401 | 78,407 |

이는 **기존 측정값의 인용**이며 이번의 독립 RGB/알파 차분 검증 결과가 아니다. 변경 픽셀 수는 빨강 지시 준수율이나 자연스러운 천의 비율을 뜻하지 않는다. 현재 열람 자료는 RGB 이미지이므로 투명 가장자리·반투명 알파의 품질을 대표하지 않는다.

## 4. 개선 후보 수용 기준

### 비교 자료가 갖춰져야 평가 가능

총괄이 지정한 baseline과 후보 각각에 원본·마스크·실제 결과, job ID, seed, 모델, 최종 prompt/negative, steps/CFG/denoise/sampler/scheduler/ROI/feather, recipe/workflow, 시간·캐시/denoiser 근거가 연결되어야 한다. 원본·마스크 해시와 seed를 맞추고 의도한 변경 변수 하나를 명시한다. 다른 변수가 함께 바뀌면 효과를 분리할 수 없다고 기록하며 단일 변수 개선을 주장하지 않는다. 동일 조건의 실제 baseline/후보 쌍이 없으면 개선 판정은 유보한다.

### 네 기준 모두 필수

| 기준 | 후보의 합격 조건 | 탈락 또는 유보 조건 |
| --- | --- | --- |
| 지시 반영 | 선택된 스카프가 일관된 빨강 천으로 읽히고, 명암과 하이라이트도 그 색의 재질로 이어진다. 선택 밖 원본과 마스크 누락은 구분한다. | 선택 안에 B1 수준의 큰 파란 고리가 남거나 B2처럼 빨간 줄·조각만 추가되면 탈락. 선택 자체가 필요한 천을 제외했다면 범위 문제를 별도 기록한다. |
| 형태 보존 | 원래 목 감김·늘어진 방향·폭·길이·술 위치와 천의 연속성이 유지된다. 색 변경에 필요한 작은 명암/주름 조정은 허용한다. | 새 고리·매듭·천 조각, 몸통을 재해석한 갈색 띠, 큰 길이/폭/실루엣 변화가 생기면 탈락한다. |
| 경계·재질 | 전체 보기와 원본 100% 크기에서 목/몸통 접촉부·천 끝·술이 자연스럽고 기존의 굵은 선·단순 2D 명암과 어울린다. | 잘린 접합부, 색 테두리·번짐·밝은 잔여 조각, 어색한 앞뒤 겹침, 국소적인 화풍 변화가 보이면 탈락한다. 마스크 경계와 천 고유의 외곽선은 구분한다. |
| 캐릭터 특징 | 눈·눈썹·입/표정·팬케이크 층·팔/장갑·다리/신발·포즈·배경과 요청하지 않은 특징을 유지한다. 요청한 스카프 색 변경은 허용한다. | 특징/포즈/몸통 구조가 달라지면 탈락한다. 다른 캐릭터 사례는 그 원본의 특징 목록을 먼저 정한다. |

네 항목 중 하나라도 미충족 또는 일부 충족이면 품질 채택은 보류한다. 관찰할 수 없는 항목은 판단 유보로 남긴다. 합계 점수나 빨간 면적 증가로 실패 항목을 상쇄하지 않는다. 총괄이 지정한 baseline보다 목표 항목이 좋아지고 나머지 항목이 악화되지 않아야 개선으로 판단한다.

별도로 QA가 마스크 밖 RGB/알파 최대 오차 0 및 원본·저장·후보·모션·출력 계약 보존을 확인해야 한다. 이 UX 육안 판정은 해당 검증을 대신하지 않는다. 테스트 통과와 이미지 품질 합격도 서로 대신할 수 없다.

## 5. 대표성 한계와 다음 검토 준비

이 자료는 생성·부분 수정의 기술 검증을 위해 만든 **단일 2D 팬케이크 마스코트/스카프 색 변경 샘플**이다. 캐릭터가 포함되어 있어 국소 색 변경 실패를 보여주지만, 사용자의 다양한 캐릭터·복잡한 의상·가는 선·얼굴 수정·피부/머리카락·반투명 경계·실제 손그림 마스크·모션 결과의 품질을 대표하지 않는다. 반복 seed나 다른 원본의 안정성도 확인하지 않았다. 이 세 결과로 전체 캐릭터 품질이나 출시 준비 완료를 주장하지 않는다.

baseline 평가와 후보 수용 기준은 정리했다. 개선 후보는 아직 지정·열람하지 않았다. 총괄이 실제 baseline/후보와 대응 기록을 지정하면 같은 네 항목으로 전후를 재검토하고, 이번 파일에 별도 후속 판정을 덧붙일 준비가 되어 있다. 새 생성이나 다른 담당 채팅 메시지 발송은 수행하지 않는다.

변경 파일: `docs/team-macos-20261022/quality/ux.md` 한 개.

## 6. 2026-10-23 후속 시각 수용 검토

**후속 평가 완료: 지정된 네 결과 모두 미수용. backend 변경 채택을 권고할 품질 근거는 확보되지 않았다.** 총괄이 아직 backend 변경을 채택하지 않았다는 배정 전제 아래 평가했다. 앞의 1차 기록은 그대로 두며, 아래 C0–C3는 이번에 지정된 비교군이다.

### 6.1 직접 확인한 자료와 실행 경로

`view_image(detail="original")`로 이번 baseline의 원본·마스크와 C0–C3 결과를 직접 열람했다. 각 디렉터리의 recipe/workflow, 앱 job의 verification/metrics, 직접 그래프 실험의 summary/metrics/submitted 기록을 대조했다. 파일 SHA-256과 크기/모드, workflow 차이도 읽어 확인했다. 이번 작업에서 GPU·앱 HTTP·브라우저·새 생성·테스트를 실행하지 않았다.

공통 원본 [baseline/original.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/baseline/original.png>)과 마스크 [baseline/mask.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/baseline/mask.png>)는 네 디렉터리에서 각각 파일 해시가 같다. 원본은 1024×1024 RGB, 마스크는 같은 크기의 L 모드이며 흰 선택 영역 78,410픽셀과 경계 상자 `(300,496)–(732,859)`도 같다.

- 공통 원본 SHA-256: `604aa7ebad79be9f27d6d8bd47c8e98362a53f6bf376c9e1e84c00842d0c1819`
- 공통 마스크 SHA-256: `7d105beccbe26749dab199cd50b85b89c4ba073e2a6cecadc535713689662481`
- 공통 recipe와 실제 workflow sampler 입력: seed `20261023`, SDXL Base(`sd_xl_base_1.0.safetensors`), 25 steps, CFG 6.0, `dpmpp_2m`, denoise 0.65, negative 빈 문자열. recipe에는 ROI false, halo 32, feather 4가 기록되어 있다. scheduler는 C3만 `normal`, 나머지는 `karras`다.

| 구분·직접 본 결과 | 실행 경로와 식별자 | 설정·결과 대응 근거 |
| --- | --- | --- |
| C0 baseline · [edited.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/baseline/edited.png>) | **Pankeki 앱 HTTP job** `f81c5ae1a15348578eaa418f38d978c9` · Comfy prompt `5312f97a-1bac-4726-aea1-54c3a374958f` | [edit-verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/baseline/edit-verification.json>)의 실제 [job recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/f81c5ae1a15348578eaa418f38d978c9/recipe.json>)·[workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/f81c5ae1a15348578eaa418f38d978c9/workflow.json>)를 대조했다. 결과 해시 `e4f521c0…398e`. |
| C1 prompt-only · [edited.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/prompt-only/edited.png>) | **Pankeki 앱 HTTP job** `4ea0fc286c9b481aa48c1a8a3f33d045` · Comfy prompt `aa456300-e270-4277-b3c0-1ed822fe649b` | [edit-verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/prompt-only/edit-verification.json>)의 실제 [job recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/4ea0fc286c9b481aa48c1a8a3f33d045/recipe.json>)·[workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/4ea0fc286c9b481aa48c1a8a3f33d045/workflow.json>)를 대조했다. 결과 해시 `84685339…a68f`. |
| C2 인코딩 중립화 · [neutral-065/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/neutral-065/result.png>) | **Comfy 직접 그래프 실험** `experiment-14bd526ff3354385b1dd63e1c9384517` · Comfy prompt `f7a931cd-1d67-47a9-821a-3c99001840e1` | [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/neutral-065/recipe.json>)·[workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/neutral-065/workflow.json>)·[summary](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/neutral-065/summary.json>). 결과 해시 `86633471…49c3`. |
| C3 scheduler normal · [preserve-normal-065/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/preserve-normal-065/result.png>) | **Comfy 직접 그래프 실험** `experiment-7200682948bb4310b622631df22e5203` · Comfy prompt `34095f7a-c611-46aa-974b-7159efe55cd3` | [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/preserve-normal-065/recipe.json>)·[workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/preserve-normal-065/workflow.json>)·[summary](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/preserve-normal-065/summary.json>). 결과 해시 `c978bbdc…6b44`. |

C0/C1의 실제 job 디렉터리에 있는 original/mask/result/recipe/workflow는 각 비교 디렉터리의 복사본과 바이트 단위로 같았다. C0 결과는 1차 B0 결과와도 이미지 파일 해시가 같다. 따라서 새 baseline의 시각 판정은 B0와 일치하지만, 새 앱 job ID는 별도로 보존한다.

**앱 HTTP 두 건과 직접 그래프 두 건은 서로 다른 증거 범위다.** C0/C1은 앱 API job 결과이고, 이번에 브라우저 UI 조작을 재현한 것은 아니다. C2/C3는 제품 변경 전 직접 제출한 그래프의 결과이며 앱 API·후보 저장·부분 수정 UI 통과를 입증하지 않는다. 직접 그래프의 experiment ID/Comfy prompt ID를 앱 job ID로 바꾸어 세지 않는다.

### 6.2 같은 조건과 변경 변수 확인

현재 workflow를 C0와 직접 비교한 차이는 다음과 같다.

- **C1:** node 2의 positive text만 변경됐다. C0의 마스코트 전체 설명에서 `a bright red fabric scarf wrapped around the neck, red fabric folds, red tassels, clean 2d cartoon illustration`로 좁혔다. negative 및 sampler/encoder 설정은 같다.
- **C2:** node 8의 `VAEEncode`를 `VAEEncodeForInpaint`로 바꾸고 mask 연결과 `grow_mask_by=0`을 추가했다. positive/negative·scheduler·denoise는 C0와 같다. 결과는 이 인코딩 구성의 해당 사례로만 해석한다.
- **C3:** node 5의 scheduler만 `karras`에서 `normal`로 바뀌었다. positive/negative·기존 `VAEEncode`·denoise는 C0와 같다.

각 후보는 C0에 대해 한 가지 설정 요인을 바꾼 비교다. C1과 C2, C2와 C3를 서로 한 변수 비교로 간주하지 않는다. 한 원본·한 마스크·한 seed의 결과이므로 다른 캐릭터나 모든 생성 조건의 일반 효과까지 단정하지 않는다.

[image-ai.md](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/docs/team-macos-20261022/quality/image-ai.md>) 열람본에는 baseline 준비 중이라는 초기 상태와 비교 계획이 남아 있었다. 뒤이어 준비된 [comparisons.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/comparisons.json>) 및 위 개별 실행 자료와 대조했으며, 초기 인계의 예정 문구를 완료 증거로 사용하지 않았다. 최종 시각 판정은 해당 인계나 색상 지표를 대신 인용하지 않고 직접 본 이미지에 근거한다.

### 6.3 네 가지 기준의 독립 육안 판정

| 기준 | C0 baseline | C1 prompt-only | C2 인코딩 중립화 | C3 scheduler normal |
| --- | --- | --- | --- | --- |
| 지시 반영 | **미충족.** 선택된 스카프가 파랗고 빨간 천으로 읽히지 않는다. | **미충족.** 목과 늘어진 천이 여전히 파랗다. prompt를 천 중심으로 바꿔도 목표 색을 얻지 못했다. | **미충족.** 빨강 대신 평평한 회색 덮개가 나타난다. 파랑이 줄었다는 것만으로 지시 반영이 아니다. | **미충족.** C0처럼 파란 스카프가 남는다. 빨강 지시의 가시적인 개선을 확인하지 못했다. |
| 의도치 않은 형태 변화 억제 | **일부 충족.** 큰 감김/늘어진 방향은 유지하나 주름과 술의 위치·선이 원본과 달라진다. | **미충족.** 늘어진 천이 더 둥글고 깊게 분리되어 보이고, 천 끝의 높이·폭과 술 뭉침이 재구성된다. 색 변경에 필요한 범위를 넘는다. | **미충족.** 천의 주름·술과 고유 윤곽이 사라지고 선택 다각형 모양의 큰 덮개로 바뀐다. | **일부 충족.** 큰 실루엣은 유지하지만 천의 주름과 술 끝이 다시 그려진다. 형태 보존의 개선을 확인하지 못했다. |
| 경계·재질 | **일부 충족.** 굵은 선과 명암의 큰 맥락은 이어지나 술 선이 얽히고 끝이 뭉친다. 빨강 천의 적합성은 지시 실패로 확인할 수 없다. | **미충족.** 서로 다른 높이의 천 끝·술과 밝은 틈/조각이 생겨 연속된 천으로 읽기 어렵다. | **미충족.** 기존 2D 윤곽·광택·주름과 어울리지 않는 균일한 회색 면과 선택 경계가 드러난다. | **일부 충족.** C0와 비슷한 파란 명암·얽힌 술이 남는다. 경계/재질이 더 자연스러워졌다고 볼 근거가 없다. |
| 캐릭터 특징 유지 | **충족(가시 주요 특징).** 얼굴·표정·포즈·팔다리·배경은 원본과 같게 보인다. 스카프 세부 변화는 앞 항목에서 별도 평가했다. | **일부 충족.** 얼굴과 포즈는 유지되지만 목/몸통 앞 의상의 늘어짐과 끝 형태가 바뀐다. | **일부 충족.** 얼굴·팔다리 등 선택 밖 특징은 남지만 캐릭터 의상의 스카프 구조와 재질 단서가 지워진다. | **충족(가시 주요 특징).** 얼굴·표정·포즈·팔다리·배경은 유지되어 보인다. 이 사실만으로 색 변경 실패를 상쇄하지 않는다. |

**C0–C3 모두 미수용한다.** C1은 목표 색 미반영과 천 끝 구조 변화, C2는 목표 색 미반영과 큰 형태/재질 손상, C3는 목표 색 미반영과 개선 미확인이 사유다. C3를 C0와 픽셀까지 동일한 결과라고 주장하지는 않는다. 두 결과의 이미지 해시는 다르지만 시각 수용 결론은 같다.

### 6.4 실행·보존 수치와 시각 품질의 구분

아래는 기존 verification/summary/comparisons에서 읽은 측정값이며 이번의 독립 픽셀 차분 결과가 아니다.

| 기존 실행 기록 | C0 앱 HTTP | C1 앱 HTTP | C2 직접 그래프 | C3 직접 그래프 |
| --- | --- | --- | --- | --- |
| elapsed_s | 32.15초 | 28.16초 | 27.514초 | 27.582초 |
| 마스크 밖 최대 오차 / alpha 최대 오차 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| 선택 안 변경 픽셀 | 78,395 | 78,399 | 78,410 | 78,400 |

네 metrics의 `denoiser_executed: true`와 history의 `execution_success`를 읽었다. 일부 입력/텍스트 노드는 캐시되어 있지만, 기록된 `execution_cached` 목록에는 sampler node 5가 없다. 직접 그래프 두 건은 앱의 exact cache를 통과한 job이 아니다. 이 기록을 이번 UX 담당이 새 추론을 수행한 것으로 세지 않는다. 경로별 elapsed_s의 측정 경계를 동일하다고 전제하여 속도 개선 순위를 매기지 않는다.

색상 임계값 지표는 선택 안 RGB의 대리 지표이며 천·형태의 의미를 판정하지 않는다. 특히 C2는 파랑 지표가 크게 낮아도 실제로 회색 덮개가 되어 품질 실패다. 마스크 밖 오차 0과 선택 안 변경 픽셀 수 역시 지시 준수·자연스러운 경계의 증거를 대신하지 않는다. 원본은 불투명 RGB이므로 투명/반투명 알파 품질의 대표성 한계도 유지한다.

### 6.5 후속 결론과 변경 범위

이번 비교에서 수용 가능한 개선 후보는 없다. backend 변경 채택이나 프롬프트/스케줄러 변경의 제품 반영을 권고하지 않는다. 직접 그래프 결과를 앱의 개선 완료로 승격하지 않으며, 추가 추론·새 모델·추가 구현은 이 평가의 실행 범위에 포함하지 않았다. QA의 독립 보존/회귀 판정과 총괄의 통합 결정은 별도다.

후속 시각 평가를 마쳤으며 총괄의 다음 배정을 기다린다. 변경은 이 파일의 **6절 후속 평가 추가**뿐이고 기존 1차 기록과 다른 파일은 수정하지 않았다.

## 7. 2026-10-23 2차 전용 모델 격리 비교

**판정 완료: smoke와 두 비교 결과 모두 미수용한다.** 전용 모델은 두 강도에서 모두 빨강 지시를 충족하지 못했다. Base 0.99는 빨강을 일부 반영하지만 원래 천과 몸통의 구조를 훼손한다. 이 고정 사례에서 제품 반영을 권고할 후보는 없다.

### 7.1 직접 열람과 입력 대응

이번에 `view_image(detail="original")`로 [smoke 원본](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/original.png>)·[마스크](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/mask.png>), 아래 세 결과와 재사용 Base 0.65 결과를 직접 보았다. 처음에는 마지막 비교의 결과/summary가 없었으나, 두 파일이 완성된 뒤 실제 이미지를 열람하고 판정했다.

| 구분 | 직접 본 결과와 실행 근거 | Comfy prompt ID · 결과 해시 |
| --- | --- | --- |
| D0 전용 0.99 smoke | [result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/result.png>) · [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/recipe.json>) · [workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/workflow.json>) · [summary](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/summary.json>) | `8ef468b5-7371-4fac-92bc-ed0c4af05ae2` · `8594d5db…e457` |
| D1 전용 0.65 | [compare-inpaint-065/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-inpaint-065/result.png>) · [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-inpaint-065/recipe.json>) · [workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-inpaint-065/workflow.json>) · [summary](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-inpaint-065/summary.json>) | `c357de7a-ef59-4baa-b88e-f6680c92ddcc` · `634edb4a…df3b` |
| D2 Base 0.99 | [compare-base-099/result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/result.png>) · [recipe](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/recipe.json>) · [workflow](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/workflow.json>) · [summary](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/summary.json>) | `034d14e5-077f-4d98-bf55-3016d51c0188` · `f34c5c2c…9f8f` |

원본·마스크·seed·prompt의 일치를 확인했다.

- 세 디렉터리의 `original.png`와 `mask.png`는 서로 같고, 재사용 [Base 0.65 원본/결과 기록](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/baseline/edit-verification.json>)의 입력과도 바이트 단위로 같다. 원본/마스크의 전체 SHA-256은 6.1에 기재한 `604aa7eb…1819` / `7d105bec…2481`과 일치한다. 결과 파일 해시도 각 summary의 `result_sha256`과 일치했다.
- 원본/결과는 1024×1024 RGB, 마스크는 1024×1024 L이다. 같은 마스크를 사용하므로 선택 밖 파란 조각과 선택 안 지시 실패를 구분하는 기준도 유지한다.
- recipe와 실제 workflow에서 seed `20261023`, 25 steps, CFG 6.0, `dpmpp_2m`, `karras`, negative 빈 문자열을 확인했다. recipe의 feather 4·ROI false·1024×1024도 공통이다. denoise는 D0/D2가 0.99, D1과 재사용 C0가 0.65다.
- 실제 positive는 세 실험과 재사용 C0 모두 `a friendly little pancake mascot character, full body, wearing a bright red fabric scarf, simple clean 2d illustration, cream background, centered composition, no text`로 같다.

### 7.2 방법과 필수 conditioning을 묶은 비교

[plan.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/plan.json>)과 실제 workflow를 대조했다. Base는 `sd_xl_base_1.0.safetensors`의 MODEL과 `VAEEncode` → `SetLatentNoiseMask`를 사용한다. 전용 방법은 Base의 CLIP/VAE를 유지하면서 `UNETLoader`로 `sdxl-inpainting-0.1-unet-fp16.safetensors`를 읽고, `InpaintModelConditioning(noise_mask=true)`의 positive/negative/latent를 sampler에 연결한다.

따라서 **전용 UNet과 필수 9채널 conditioning을 결합한 방법 비교**다. UNet 하나만 바꾼 효과로 해석하지 않는다. 다른 API의 strength와 이번 Comfy denoise가 같은 스케줄이라고 주장하지도 않는다.

| 같은 강도의 비교 쌍 | 고정한 조건 | 실제 비교 요인과 관찰 |
| --- | --- | --- |
| C0 Base 0.65 ↔ D1 전용 0.65 | 원본·마스크·seed·prompt/negative·denoise 및 공통 sampler 설정 | 방법과 필수 conditioning의 결합 차이. 두 결과 모두 파랑이 남아 목표 색의 개선을 확인하지 못했다. C0는 job `f81c5ae1a15348578eaa418f38d978c9`의 기존 결과를 재사용하며 새 Base 0.65 추론으로 세지 않는다. |
| D2 Base 0.99 ↔ D0 전용 0.99 smoke | 위와 같은 입력 및 denoise 0.99 | 방법과 필수 conditioning의 결합 차이. Base의 부분적인 빨강과 큰 구조 손상, 전용의 파랑 잔류를 각각 실패로 기록한다. 어느 쪽도 네 기준을 모두 통과하지 못했다. |

D0와 기존 C0를 바로 비교하면 방법뿐 아니라 denoise도 달라진다. D0 ↔ D1은 같은 전용 방법 안의 강도 비교이며, 두 결과의 차이를 Base 대비 전용 방법의 단독 효과로 바꾸어 설명하지 않는다. 한 원본·마스크·seed와 고정 설정의 사례이므로 전용 모델 전체의 최적 품질이나 다른 캐릭터의 성능으로 일반화하지 않는다.

신규 세 건은 **격리된 Comfy 그래프 실험**이다. 기록에 있는 Comfy prompt ID를 Pankeki 앱 job ID로 부르지 않는다. GPU handoff의 UI job `ef48762b02b2449eb486138a3d46234e`는 다른 편집 문구를 사용했다는 AI 인계에 따라 이 고정 prompt 비교에서 제외했다. 새 결과가 앱의 부분 수정·후보 저장 UI를 통과했다는 판정도 추가하지 않는다.

### 7.3 직접 본 이미지의 네 가지 판정

| 기준 | D0 전용 0.99 smoke | D1 전용 0.65 | D2 Base 0.99 |
| --- | --- | --- | --- |
| 지시 반영 | **미충족.** 목과 늘어진 천이 여전히 파랑이다. 밝은 빨강 스카프가 되지 않았다. | **미충족.** 목·천 끝의 주색이 파랑으로 남는다. 재사용 C0와 같은 핵심 지시 실패다. | **일부 충족.** 목 안쪽과 하단에 선명한 빨강이 생기지만 큰 파란 감김이 남아 일관된 빨강 천으로 읽히지 않는다. |
| 의도치 않은 형태 변화 억제 | **미충족.** 원래 비스듬한 천 끝이 좁고 수직인 형태로 바뀌고, 술이 길고 가는 직선 가닥으로 재구성된다. | **일부 충족.** 큰 목 감김과 늘어진 방향은 유지하나 천의 주름·폭과 술의 위치/곡선이 달라진다. | **미충족.** 원래 길게 늘어진 천이 사라지고 그 자리에 팬케이크 몸통층처럼 보이는 형태가 들어온다. 하단에 짧은 빨간 술만 떨어져 남는다. |
| 경계·재질 | **일부 충족.** 굵은 2D 선과 파란 명암은 이어지지만, 가늘고 긴 술과 단순해진 천 끝은 원본의 선 밀도·천 표현과 다르다. | **일부 충족.** 큰 명암은 이어지나 술이 가늘게 갈라지고 밝은 틈/가닥이 생긴다. 목표 색의 천 재질은 지시 실패로 확인할 수 없다. | **미충족.** 목의 빨강/파랑, 몸통처럼 채워진 중앙, 떨어진 하단 술이 하나의 연속된 천으로 이어지지 않는다. |
| 캐릭터 특징 유지 | **일부 충족.** 얼굴·표정·포즈·팔다리는 유지되지만 의상의 늘어진 실루엣과 끝 특징이 바뀐다. | **충족(가시 주요 특징).** 얼굴·표정·포즈·몸의 큰 실루엣·팔다리는 유지되어 보인다. 천의 세부 변화는 앞 항목에서 별도 평가했다. | **일부 충족.** 얼굴과 포즈는 유지되지만 몸통 앞의 층 구조와 스카프가 만나는 관계가 바뀐다. 요청된 빨강 자체를 감점한 것은 아니다. |

**D0/D1/D2 모두 미수용한다.** D2의 빨강 반영만으로 형태·경계 실패를 상쇄하지 않는다. D0/D1이 회색 덮개가 아니고 캐릭터를 유지한다는 사실도 목표 색 실패를 상쇄하지 않는다. 네 축 중 일부만 좋아 보이는 결과를 제품 채택 후보로 올리지 않는다.

### 7.4 기술 기록과 품질 판정의 구분

다음 수치는 기존 phase summary를 읽은 기록이며 이번 UX 담당의 독립 픽셀·latent 검증이 아니다.

| 기존 summary 항목 | D0 전용 0.99 | D1 전용 0.65 | D2 Base 0.99 |
| --- | --- | --- | --- |
| technical_pass | true | true | true |
| elapsed_s | 33.932초 | 26.722초 | 31.225초 |
| 마스크 밖 최대 오차 / alpha 최대 오차 | 0 / 0 | 0 / 0 | 0 / 0 |
| 선택 안 변경 픽셀 | 78,401 | 78,402 | 78,404 |
| sampler cache / 성공 history | 미적중 / 성공 | 미적중 / 성공 | 미적중 / 성공 |

세 summary는 실제 sampler latent의 유한성, 비유한값 0, NaN/cast 경고 없음과 preview 25개를 기록한다. VAE 디코딩 직후 float의 유한성은 직접 노출되지 않았다고 구분되어 있다. 이 기록이나 PNG 정수 픽셀만으로 VAE float 전체까지 검증했다고 확장하지 않는다. 원본이 불투명 RGB인 점과 실제 반투명 알파 품질의 미확인 한계도 유지한다.

`technical_pass=true`와 `four_axis_quality=not_evaluated`는 함께 기록되어 있다. 실행 성공을 품질 합격으로 읽지 않고 위의 직접 육안 판정을 별도로 남겼다. 시간은 업로드·모델 로드·관측을 포함하는 client wall time이며 GPU 연산 시간이나 단독 성능 우열이 아니다.

### 7.5 완료 상태와 변경 범위

smoke와 이어진 두 비교 결과까지 모두 열람해 수용 검토를 마쳤다. 이번 범위에서 수용 가능한 후보와 제품 반영 권고는 없다. 추가 모델·파라미터 탐색이나 추론을 진행하지 않았다. QA의 독립 보존/회귀 검증과 총괄의 이후 결정은 별도다.

수정은 이 문서의 **7절 후속 평가 추가**뿐이다. 기존 평가와 다른 파일은 수정하지 않았으며 GPU·브라우저·제품 실행 경로를 사용하지 않았다. 총괄의 다음 배정을 기다린다.
