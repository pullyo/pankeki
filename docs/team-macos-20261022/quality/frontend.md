# 부분 수정 프런트 요청 경계 개선

2026-10-22 KST · 프런트엔드 담당 · 총괄이 진단과 최소 수정안을 검토한 뒤 요청 분기·회귀 테스트·모드별 입력 안내 수정을 승인했다.

**현재 결과:** inpaint는 사용자 편집 설명만 positive prompt로 보낸다. 생성용 자동 스타일, 기존 캐릭터 brief/appearance/detail/profile/palette를 덧붙이지 않는다. txt2img의 기존 조합 문자열은 유지했다. 제품 소스와 테스트는 수정했으며, 최종 빌드·브라우저·서버·GPU 검증은 총괄의 통합 단계로 남아 있다.

프로젝트 루트는 `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki`이며 아래 경로는 루트 기준이다.

## 구현과 보존 계약

| 위치 | 변경 결과 |
| --- | --- |
| `web/src/redesign.js:28–44` | `preparePrompt(value,id,mode='txt2img')`와 `submitPrompt`가 현재 모드로 분기한다. inpaint는 설명을 정리한 뒤 반환하고 스타일을 추가하지 않는다. 기본 두 인자 호출과 txt2img의 기존 스타일 교체·길이 검사 경로는 유지한다. |
| `redesign.js:46–55` | `descriptionText`는 **설명 뒤 두 줄바꿈으로 붙은 알려진 스타일 suffix 하나만** 제거한다. 스타일 문장 단독 입력, 공백/한 줄바꿈으로 연결한 문장, 사용자가 직접 쓴 다른 스타일은 요청과 표시 기록에 남는다. 가시 입력의 refresh도 같은 helper를 사용해 단독 스타일 지시가 사라지는 것을 막는다. |
| `web/src/profiles.js:115–121` | `buildPrompt`는 모드 유효성 검사와 sanitize 뒤 inpaint이면 `brief.prompt`만 반환한다. txt2img의 useBrief 처리와 필드 조합 순서는 그대로다. 저장된 다른 브리프 필드와 useBrief 값은 지우거나 바꾸지 않는다. |
| `redesign.js:295–301` | summary.mode가 inpaint일 때 가시 label·aria-label을 **수정할 내용**, placeholder를 **선택 영역에서 바꿀 내용을 적어주세요.**로 바꾼다. txt2img는 기존 이미지 설명·placeholder로 돌아간다. |
| `web/src/redesign.css:206` | `body.pankeki-pc[data-studio-screen=inpaint] .pk-categories{display:none}`으로 부분 수정 화면의 자동 스타일 선택 영역을 숨긴다. 생성 화면에는 이 규칙이 적용되지 않는다. 템플릿·레이아웃·사이드 메뉴는 변경하지 않았다. |

기존 연결은 `pcPrompt → 숨은 prompt의 input → app.readBrief → requestSnapshot/buildPrompt → makeRequests → /api/jobs POST`다. 실제 생성·취소·원본/마스크·프로젝트의 소유자는 계속 app.js다. source/mask, negative, seed·모델·추론 설정은 바꾸지 않았다. 새 후보의 parentId, 기존 후보와 저장 request.prompt를 테스트로 확인했다.

설명 뒤 **두 줄바꿈 + 알려진 스타일 문장**과 완전히 같은 형태의 직접 입력은 자동 suffix와 구분할 메타데이터가 없다. 승인된 문자열 규칙에 따라 이 형태만 제거한다. 스타일 문장 자체를 단독 지시로 쓰거나 다른 스타일을 직접 쓰는 경우는 보존한다. notes는 기존과 같이 모델 입력에 포함하지 않는다.

## 수정 전 재현과 수정 후 요청

기존 VM harness로 캡처한 요청이다. 공통 조건은 SDXL Base, seed 42, 1024×1024, 25 steps, cfg 6, denoise 0.55, dpmpp_2m/karras, negative=`blurry, artifacts`다.

수정 전 inpaint/character/useBrief=true의 최종 positive prompt:

```text
Change only the scarf to red. Preserve its shape and all other colors.

Expressive original character design, detailed 2d anime illustration.
A friendly mascot character.
The character wears a blue scarf and a green coat, with round ears.
A plain white background.
Original character concept art, a distinctive coherent silhouette, readable outfit and meaningful accessories, one character.
Suggested palette: #0000FF, #008000, #FFFFFF.
```

수정 후 같은 입력의 대역 POST 및 저장된 후보 request.prompt:

```text
Change only the scarf to red. Preserve its shape and all other colors.
```

기존에는 preparePrompt가 모드를 받지 않고 스타일을 붙였고, buildPrompt는 mode를 검사한 뒤 두 모드에 같은 전체 조합을 사용했다. useBrief=false로도 자동 스타일은 남았다. 현재는 이 두 주입점을 모두 분기했다. txt2img 비교군은 위 수정 전 전체 문자열과 정확히 같으며, source/mask 및 parent 계보만 기존 모드 계약을 따른다.

## RED와 GREEN 증거

제품 수정 전에 `scripts/test_inpaint_prompt_boundary.cjs`의 진단 기대값을 개선 계약으로 전환하고 `web/tests/profiles.test.cjs`에 모드별 검사를 추가했다. 기존 전체 브리프 길이·개인 필드 제외 검사는 txt2img로 명확히 옮겼다.

| 실행 | 실제 결과 |
| --- | --- |
| RED: 위 2개 테스트 파일, 제품 소스 수정 전 | 29건 / 21통과 / **8실패** / skip·TODO 0 / exit 1 |
| GREEN: 같은 2개 파일, 최소 수정 후 | **29/29 통과**, 실패·skip·TODO 0 / exit 0 |
| 전체 JavaScript 회귀: 아래 10개 파일 | **153건 / 151통과 / 1skip / 1TODO / 0실패**, exit 0 |

RED에서 실패한 검사는 다음과 같다. 추가 스타일·기존 브리프가 실제 request.prompt에 남거나, 스타일 문장 처리·4000자 편집 예산이 기대와 다른 이유로 실패했다.

- `inpaint sends only the local edit without old appearance, palette or automatic style`
- `inpaint ignores automatic style and brief controls without changing their stored values`
- `txt2img keeps its complete prompt while inpaint changes only the positive prompt and source contract`
- `inpaint removes only a known style suffix separated from an edit by two newlines`
- `inpaint preserves a style sentence used as the edit in both the request and displayed history`
- `inpaint preserves user style instructions without the automatic suffix delimiter`
- `inpaint rejects empty edits without a job and accepts the full 4000 character description budget`
- `inpaint builds only the edit prompt for every profile without mutating the brief`

GREEN은 useBrief true/false, 캐릭터/배경/SD 선택, 알려진 자동 suffix 제거, 스타일 문장 단독 입력, 공백/한 줄바꿈 연결, 직접 쓴 수채화 지시, 빈 입력·길이 제한을 확인한다. 다섯 프로필의 원본 브리프 비변경, txt2img의 기존 문자열, 기존 후보·source/mask·부모 계보·negative·추론 설정과 저장 prompt도 확인한다.

전체 회귀에는 생성·취소·복원·저장·모션·프레임 출력의 기존 상태 검사가 포함된다. skip/TODO는 기존 렌더러의 실제 RGBA/알파 경계 브라우저 항목이며 이번 수정에서 새로 생긴 보류가 아니다. 과거 144건 또는 진단 단계 66건 기록과 합산하지 않는다.

Node v24.19.0에서 실행한 RED/GREEN 공통 명령:

```sh
/Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=spec scripts/test_inpaint_prompt_boundary.cjs web/tests/profiles.test.cjs
```

전체 회귀 명령은 브라우저 픽셀 검사를 명시적으로 끈다:

```sh
PANKEKI_RENDERER_PIXELS=0 /Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=spec scripts/test_character_document.cjs scripts/test_character_export.cjs scripts/test_character_motion.cjs scripts/test_character_renderer.cjs scripts/test_motion_app.cjs scripts/test_studio_state.cjs scripts/test_ui_state.cjs scripts/test_redesign.cjs scripts/test_inpaint_prompt_boundary.cjs web/tests/profiles.test.cjs
```

## 검증 한계와 총괄 통합 항목

VM harness는 실제 profiles.js/app.js/redesign helper를 실행하고 대역 fetch가 받은 POST body를 검사한다. redesign DOM은 mount하지 않으며, pcPrompt 이벤트 연결과 UI 변경 위치는 소스로 대조했다. Image/Canvas/IndexedDB/API는 대역이고 source=기존 RED, mask=WHITE PNG fixture다.

빌드·브라우저·서버·GPU는 사용하지 않았다. 실제 UI의 스타일 영역 숨김/생성 화면 복귀, 모드별 label·placeholder·포커스·새로고침은 총괄의 한 번의 빌드와 브라우저 검수에서 확인해야 한다. 실제 job ID·GPU 시간·픽셀 오차·이미지 품질 개선 판정도 만들지 않았다. 지시 충돌 제거와 실제 형태·색·경계 개선의 인과는 이미지 AI·QA의 동일 조건 비교로 판단한다.

web/index.html은 이전 빌드 그대로다. 소스 수정이 현재 실행 앱에 통합되었다고 주장하지 않는다. 다른 채팅 메시지나 추가 채팅·하위 에이전트는 사용하지 않았다.

## 정확한 변경 파일

1. `web/src/redesign.js`: 모드별 prepare/submit, 제한된 suffix 제거, 입력 label/placeholder/aria-label.
2. `web/src/profiles.js`: inpaint의 편집 설명 단독 반환.
3. `web/src/redesign.css`: inpaint 화면의 스타일 선택 영역 숨김.
4. `scripts/test_inpaint_prompt_boundary.cjs`: 진단에서 8개 회귀 검사로 전환.
5. `web/tests/profiles.test.cjs`: txt2img 검사 구분과 프로필별 inpaint 비변경 검사.
6. `docs/team-macos-20261022/quality/frontend.md`: 현재 구현·RED/GREEN·한계 기록으로 갱신.

이번 구현 전후 app.js/studio.js/web/index.html의 SHA-256은 동일하다.

```text
web/src/app.js     b0c69ae04f02bd9f2503c19940e39d08997da77033339d7b7aa9a52a4e6a0e57
web/src/studio.js  3c64df5b59b2617552fd946dc34821b8f8505cf4fb89c6117fa3e646064de620
web/index.html    1f1104d95f78bf76843cbe4645d8535b6d217ac86ed89b8a6e9c18405fed33eb
```

## 2026-10-23 키보드 힌트 최소 보정

총괄은 1440×900의 실제 ui-result.png를 검토하고 요청 경로·라벨·스타일 영역 숨김을 수용했다고 보고했다. 남은 고정 문구인 Enter 생성만 모드에 맞춰 보정했다. 이 화면 검토는 총괄의 보고이며 이번 담당자가 새 브라우저 검증을 수행한 것은 아니다.

- 변경 위치: `web/src/redesign.js:299`, 기존 `refresh(summary,reason)`의 editing 분기 옆 한 줄. inpaint에서는 **Enter 수정 · Shift Enter 줄바꿈**, txt2img에서는 기존 **Enter 생성 · Shift Enter 줄바꿈**으로 표시한다. kbd 마크업은 유지한다.
- 요청 구성·키보드 제출 동작·스타일·레이아웃은 바꾸지 않았다. 이번 변경 파일은 `web/src/redesign.js`와 이 인계 문서 두 개뿐이다. 테스트 파일은 추가·수정하지 않았다.
- 기존 관련 회귀 2개 파일을 실행해 **13/13 통과, 실패·skip·TODO 0, exit 0**을 확인했다. 이 검사는 실제 요청·후보 상태의 보존 검사이며 힌트의 브라우저 렌더링 검증은 아니다. 앞선 153건 전체 회귀를 이번 보정에서 다시 실행했다고 주장하지 않는다.

```sh
/Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=spec scripts/test_redesign.cjs scripts/test_inpaint_prompt_boundary.cjs
```

빌드·브라우저·서버·GPU는 사용하지 않았다. 이번 보정 시작/종료 시 web/index.html의 SHA-256은 모두 `92762a1c34f8fe30a62c1745a18f6c61f6f3d15649b757f2d812cbc9b12db58f`다. 위 10월22일 첫 구현 기록의 빌드 해시와는 다른 시점이다. profiles.js와 redesign.css도 이번 보정 전후 동일하다. 새 힌트 소스의 빌드 반영과 실제 화면 확인은 총괄 통합에 남긴다.
