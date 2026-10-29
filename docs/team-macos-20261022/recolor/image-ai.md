# 원본 픽셀 색상 변경 — 이미지 AI

2026-10-23 KST. 상태: **수동 기준색 단일 픽셀 경계 보정·fresh 전체 Python 검사 완료, 제품 코드 freeze**. 아래 1차 검증에 더해 마지막 절의 경계 보정을 완료했다. 총괄의 최종 재시작·통합 검증을 기다린다. 모델/의존성 다운로드·GPU·기존 서버 재시작·공유 브라우저 조작은 수행하지 않았다.

## 설계와 위험

기존 inpaint 작업의 CPU 분기로 구현한다. 원본 좌표에서 색 성분만 바꾸고 기존 composite의 mask/feather 정수 합성을 재사용한다. 위험은 ①마스크에 함께 든 다른 색 변경 ②가는 선·주름·광택의 평면화 ③검정/흰색 목표와 밝기 고정의 충돌 ④모델 가용성·캐시·취소/finalize 경계를 잘못 타는 것이다.

원본색은 chroma·마스크·가시 alpha로 가중한 원형 HSV hue histogram에서 추정하며, 직접 지정도 지원한다. 허용 hue 범위의 가장자리를 부드럽게 줄이고 무채색/숨은 RGB와 다른 hue를 보호한다. OKLab에서 색 성분을 옮기고 명암 순서를 유지하는 단조 tone mapping 및 gamut chroma 압축을 적용한다. 검정/흰색은 동일 밝기를 고집하지 않고 기준 lightness를 조정해 천의 명암을 남긴다. alpha는 원본 바이트를 유지한다.

## 실제 1024px 비교와 선택

기존 `ai/baseline`의 원본·마스크를 그대로 사용했다. 목표#FF0000, 원본색 자동, tolerance35, feather4로 고정했다. 두 후보는 같은 원래 색 선택을 사용하며 변환만 다르다.

- [HSV V 보존 후보](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/candidate-hsv.png>): 빨강을 반영하지만 원본의 광택/중간 명암이 다소 어둡고 탁하게 보인다. **HSV V 보존을 지각 밝기 보존이라고 부르지 않는다.**
- [OKLab 후보](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/candidate-oklab.png>): 밝은 빨강을 반영하며 주름·술·광택·외곽의 원본 픽셀 위치가 그대로다. 주요 천 부분의 명암 변화가 더 안정적이라 `oklab-recolor-v1`을 선택했다. 독립 UX/QA 수용 전 자기 판독이다.
- mask0 RGB·제외 색 RGB 오차는 두 후보 모두0이다. 완전 선택한 내부57,329픽셀의 원본/결과 OKLab L 상관은 HSV0.98269, OKLab0.99937, 평균 |ΔL|은0.05795 대0.02132다. 목표색의 명암 기준을 옮긴 결과이지 L이 완전히 같다는 주장은 아니다. 이 수치 하나로 품질을 합격시키지 않는다. [method-comparison.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/method-comparison.json>).

## API·엔진 경계

`mode=inpaint`, `edit_operation=recolor`, 필수 target HEX, 선택 source HEX/null, finite tolerance0..90(default35)를 검증한다. txt2img+recolor와 알 수 없는 operation은 거부한다. 모델 선택/설치 확인·Comfy fingerprint·workflow·exact cache 전에 분기한다. `kind=local_recolor`, `model_calls=0`, `denoiser_executed=false`, cache off이며 원본/마스크/결과·recipe.recolor·recolor-params.json·metrics를 기존 job 디렉터리에 저장한다. `_save`/finalize와 JobManager의 revision·취소 처리를 유지한다.

빈 마스크·일치색 없음·동일색은 원본을 반환하며 `metrics.skipped`에 `empty-mask`/`no-matching-color`/`same-color`를 남긴다. 양자화 후 실제 변경이 없으면 `no-visible-change`다. job 기술 완료와 실제 색 변경 성공은 프론트에서 구분해야 한다. 자동 추정 HEX는 scalar metrics 및 recipe.recolor에 남긴다.

## 기술 출처

- [W3C 비분리 blend](https://www.w3.org/TR/compositing-1/#blendingnonseparable): 색 성분과 Lum 분리의 참고. 이 구현이 CSS color blend와 동일하다고 주장하지 않는다.
- [OKLab 원저자 설명·sRGB 변환식](https://bottosson.github.io/posts/oklab/): 지각 lightness/chroma와 변환 행렬의 근거. 행렬 예제는 원문에서 public-domain/MIT로 제공된다.

## 실제 CPU job 및 증거

실제 `Engine`+`JobManager`를 전용 임시 evidence root에서 실행했다. 모델 목록은 명시적으로 비웠고, Comfy의 get/upload/execute/fingerprint 모두 호출되면 실패하도록 막았다. `cache=true`, `model_id=sdxl-base`를 보낸 요청도 로컬 분기에서 cache off로 정규화했다. HTTP 없이 실제 result·recipe·최종 metrics를 저장했다.

| 사례 | 목표 | job ID | 변경 픽셀 | 결과 |
| --- | --- | --- | ---: | --- |
| red | #FF0000 | 55f04a7cf0c44842a90e247180d16433 | 63,762 | [빨강](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/red/result.png>) |
| green | #00FF00 | 957bc49f4d214170a4552caaf4de0f40 | 63,752 | [초록](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/green/result.png>) |
| black | #000000 | 186df2e316304f3baea11fac7f5ff871 | 63,771 | [검정](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/black/result.png>) |
| white | #FFFFFF | 772514f9d6fd4873852e96fcbc884864 | 63,766 | [흰색](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/white/result.png>) |
| rgba-red | #FF0000 | 18c5673ec64649b087867c75b5279a7a | 63,506 | [RGBA](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/results/rgba-red/result.png>) |
| noop-empty | #FF0000 | 43c3526adb4242c3b5a61aa999ac89ed | 0 | empty-mask |
| noop-no-match | #00FF00 | 533b9d716ba2400389d5b70a0e068c53 | 0 | no-matching-color |
| noop-same | #0000FF | 90b276e3b78f427eaf6bdc16ed7a86a0 | 0 | same-color |

8건 전부 `kind=local_recolor`, model_calls0, exact cache puts0, 1024×1024 유지, mask0 RGB·전체 alpha·alpha0 숨은 RGB 최대 오차0이다. 원본 RGB의 자동 기준색은 #3B8CC3이며 RGBA fixture는 #3A8CC2다. 실제 5건 변환의 local_cpu_s는 약0.177~0.194초, job total_s는 약0.235~0.268초였다. 이 기기·사례의 단일 실행값이며 속도 보장은 아니다.

RGBA는 원본 마스코트 RGB에 0..255의 비균일 알파를 직접 작성한 검증용 PNG다. 사용자가 제공한 투명 원본으로 가장하지 않는다. 82,185픽셀이 비불투명하며 alpha1/128/255에서 동일 RGB 변환·alpha0 숨은 RGB 보존은 별도 픽셀 테스트로 검증했다. [RGBA 원본](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/rgba-source.png>).

- [local-jobs.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/local-jobs.json>): 각 job ID·입력/출력 SHA·설정·시간·artifact 경로. 실제 요청은 각 `local-engine/runtime/runs/<job_id>/request.json`에 보관했다.
- 각 `results/<case>/`에 original.png, mask.png, result.png, recipe.json, recolor-params.json, metrics.json, job.json을 대응시켰다. no-op도 원본 결과와 명시적 skipped를 남긴다.
- [verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/verification.json>): 저장된 PNG를 다시 열어 크기·mask0 RGB·전체 alpha·숨은 RGB·결과 hash를 재검사한 요약이다.

## 검증 및 변경 파일

새 recolor 테스트16개 통과: hue 순환·다른 색과 무채색 보호, 자동/직접 기준색, 명암 순서·가는 검은 선, red/green/black/white, fractional mask·feather, 비균일 alpha, 입력 검증, 모델 없는 실제 job, 변경 없음, 연산 중 취소 및 `_save` 직후 취소·revision 교체를 검사한다. 오래된 결과가 공개되지 않고 persisted metrics도 canceled가 되며 cache는 쓰지 않는다.

전체 Python 검사 **145개, 125통과·20skip·실패0**. 환경별 기존 skip은 그대로다. 초기 실패 로그와 최종 로그를 모두 보존했다. 임시 localhost 테스트 서버가 sandbox에서 차단돼 허용된 재실행으로 확인했으며 기존 앱/Comfy 서버를 재시작한 것이 아니다. Ruff는 설치되지 않아 실행하지 못했고 패키지를 추가하지 않았다. 변경 Python6개 AST syntax 검사는 통과했다.

- [새 테스트 로그](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/tests-green.log>) · [최종 전체 Python 로그](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/backend-regression-final.log>)
- 제품: `pankeki/recolor.py` 신규, `pankeki/engine.py` CPU 조기 분기. 기존 `_save`/finalize/JobManager는 수정하지 않았다.
- 검사: `tests/test_recolor.py` 신규, `tests/test_sdxl_inpaint_experiment.py`의 prepare 검사를 임시 합성 fixture로 독립시켰다. 제품 변경 후 실제 과거 baseline의 source fingerprint가 달라지는 것은 올바른 guard 동작이다. baseline 자료·실험 스크립트 guard는 수정하지 않았으며 stale-product 거부 검사도 추가했다. 실험 검사15개 통과.
- 재현 도구: 전용 evidence의 compare_methods.py, run_local_recolor.py. 새 모델·의존성·제품 JS/UI는 변경하지 않았다.

## 자기 판독과 남는 통합 작업

실제 네 목표색과 RGBA 출력을 직접 열어 확인했다. 천 폭/길이·겹침·주름·술 가닥·광택의 공간 위치는 원본과 같다. 빨강/초록은 고채도, 검정/흰색은 명암을 남긴 톤으로 읽힌다. **독립 QA/UX의 최종 수용 판정은 아직 아니다.** 검정/흰색의 tone 변경은 명암 순서를 유지하지만 원본과 같은 밝기나 동일 대비를 보장하지 않는다.

마스크 밖의 파란 테두리는 정확 보존하며 feather 경계에는 원래 색이 섞인다. 좁은 마스크를 넘어서 색을 없애지 않으므로 최종 경계 품질은 총괄/UX가 실제 마스크와 함께 판단해야 한다. 여러 hue·무채색만 든 영역에서는 자동 대표색이 의도와 다를 수 있다. 직접 기준색·허용 범위로 조절하며 의미 기반 물체 선택을 보장하지 않는다.

검증 시 제품 source SHA는 `731aabdebe48f44a3a2bbe371a2eab0151d3cd3be2a3837f718abeeffe0500b8`이며 실제8건 recipe와 일치한다. 실행 중인 앱에 반영하려면 총괄의 통합 재시작이 필요하다. 실제 UI 요청→후보 비교→프로젝트 저장/복원·PNG 및 안내 문구, 독립 QA/UX 수용은 총괄 범위로 남긴다.

## 최종 경계 보정 및 freeze — 2026-10-23 KST

총괄이 제시한 257×257 파란 이미지의 (1,0) 빨강 한 픽셀이 수동 기준색 #FF0000에도 no-matching-color로 무시되는 결함을 실패 회귀로 재현했다. 원인은 visible mask 표본이 65,536개 이하가 되도록 stride2로 줄어들 때 해당 픽셀이 빠지고, `_context`가 표본의 matching0을 전체 이미지의 부재로 판정한 것이다.

**제품 변경은 recolor.py의 표본 matching0·수동 기준색 분기만**이다. 제공된 reference RGB의 OKLab L/C로 context를 만들고 기존 전체 해상도 selection을 진행한다. 최종 선택 픽셀이 실제0이면 기존 no-matching-color 판정이 유지된다. 자동 추정 경로와 표본에 일치색이 있는 기존 변환 경로는 바꾸지 않았다. 관련 tests/test_recolor.py에 단일 빨강→초록·나머지 전체 픽셀 정확 보존, 실제 부재색 no-op의 회귀2개를 추가했다. engine.py·서버·모델·GPU는 이번 보정에서 건드리지 않았다.

- 실패→성공: [manual-reference-red.log](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/manual-reference-red.log>) · [manual-reference-green.log](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/manual-reference-green.log>). recolor18개 통과.
- fresh 전체 Python: **147개, 127통과·20 Windows 전용 skip·실패0**, exit0. [backend-regression-manual-reference.log](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/backend-regression-manual-reference.log>).
- 단일 픽셀 실제 PNG 및 부재색 PNG·params, 기존8건 재실행 비교: [manual-reference-fix/summary.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/manual-reference-fix/summary.json>). 단일 색1픽셀만 변경, 부재색0픽셀 변경, 기존8건 모두 결과 픽셀 바이트·skipped가 이전 증거와 같다. AST syntax 검사도 통과했다.

최종 freeze 제품 source SHA: `bd1e0cb5ed846ab6ef6b2d9ea7d8b7a67ad77deb612498d06d29ac9e5229c200`. 위 1차8건의 recipe SHA는 역사적 실행 당시 값으로 그대로 두었다. 기존8건의 출력 픽셀은 보정 후에도 동일하다. 이 상태에서 이미지 AI의 제품 수정은 멈추며 총괄이 최종 재시작한다.
