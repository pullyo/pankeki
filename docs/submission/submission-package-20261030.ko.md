# Pankeki 제출 꾸러미 — 2026-10-30 12:05 KST 기준

마감: **2026-10-30 09:00 PT = 2026-10-31 01:00 KST** (공식 페이지에서 12:05 KST에 재확인. "Submission window closes: October 30 · 9am PT"). 남은 시간 약 **12시간 50분**.

이 문서는 10/28의 [제출 폼 문항과 대본](../releases/submission-form-20261028.ko.md)을 오늘 상태에 맞게 갱신한 것이다. 앱 코드는 바꾸지 않았다. 게시·제출은 하지 않았다.

## 1. 지금 상태

| 제출 항목 | 상태 | 근거 |
| --- | --- | --- |
| GitHub 공개 저장소 | **준비됨** | `pullyo/pankeki` 공개, main 최신 커밋 1863ed6 (10/30). 루트에 `LICENSE`(MIT), `THIRD_PARTY.md`, `README.md`/`README.ko.md`, `examples/`(txt2img·inpaint API workflow JSON) |
| OSS 라이선스 | **준비됨** | GitHub가 MIT로 인식. 모델·ComfyUI·폰트는 `THIRD_PARTY.md`에 출처·라이선스 기록(10/28 점검) |
| 로컬 설치 안내 | **준비됨** | README "Start on macOS": `mac-release-20261028` 브랜치 clone → `setup-macos.sh --models` → 데스크톱 앱. 10/19 문서의 "준비 안 됨"은 옛 기록 |
| 개인 정보 노출 | 확인함 | GitHub 코드 검색에서 `plant313`, `Samsung 970` 0건. main의 docs는 handoffs·images·2개 문서뿐 |
| 2분 데모 영상 | **없음** | 아래 대본으로 녹화 필요. 공개 링크 필요 |
| `#OpenSourceHiggsfield` 게시물 | **없음** | 아래 초안. 게시는 사용자 |
| 제출 폼 입력 | 초안 있음 | 아래 4절. 개인 정보 항목은 사용자가 직접 |
| 대회 가입(Sign up) | **미확인** | 공식 페이지 1단계가 "Sign up". 가입 여부는 사용자만 안다 |

작은 불일치 하나: `mac-release-20261028` 브랜치의 README는 아직 10/29 홈 이미지를 가리킨다(main은 10/30 이미지). 제출에는 영향 없음.

## 2. 데모 전 결정과 동결

- **홈 화면 — 동결 완료.** Codex 회신(13:30경): 최종 Home source **2ccf212b** / HTML fcc2d70f가 `~/Applications/Pankeki.app`에 적용됐고, 8190 서버의 source/HTML/프로세스 일치와 네이티브 홈 전체 표시를 QA·총괄이 확인. 홈 첫 전송 문제도 격리 브라우저에서 수정 확인. **코드 동결. 녹화용 빌드 = 2ccf.** 기존 24작업·후보 9/14·미디어 보존. 패키지는 ad-hoc 서명·미공증, 모델·venv 미동봉(외부 runtime 필요). 근거: `output/finalization-20261030/home-centered-reference/qa/`.
- **아직 검증 안 된 것(Codex 명시):** 홈 최근 썸네일로 프로젝트 전환은 확인창 취소까지만 확인. → 리허설에서 직접 확인.
- **14:30 갱신 — 전체 다크 빌드 설치 완료.** 사용자가 전체 페이지 다크 시안을 선택해 Codex가 재작업. 최종 source **48f9d7e9** / HTML 801789df가 `~/Applications/Pankeki.app`에 적용됨(정상 종료·백업·원자 교체·재실행, 서명·DMG 검증 통과, 기존 24작업·미디어 보존). Claude 읽기 전용 검토 2회(결함 7건 → 모두 수정 확인). **녹화용 빌드 = 48f9d7e9 (다크).** 2ccf(밝음)는 대체 후보. 위 대본의 홈 장면은 다크 중앙형 홈(인사말·최근 이미지 4장·하단 입력창) 기준으로 찍는다. 품질 한계와 미검증 항목은 그대로 유효.
- **Codex가 밝힌 데모 한계.** Animagine 생성은 샘플 1장과 PNG 저장만 확인(임의 요청 전반의 품질 승인 아님). SDXL 부분 수정은 마스크 밖 보존은 확인됐지만 회색 배경 교체 2회 실패 → 보장 단계로 넣지 않는다(아래 대본의 1:05 구간은 선택). 새 홈 빌드에서 **프로젝트 전환 자동 검증은 미검증**(자동 승인 심사 거절로 취소된 것이며 제품 실패는 아님). PNG 저장은 과거 실측만 있고 이번 홈 변경에서는 저장/열기 대화상자 진입·취소만 확인. → 녹화 전 리허설에서 저장·재열기·PNG 저장을 한 번 직접 돌려 본다.
- **동결 뒤 반드시 앱 재시작.** 소스가 바뀌면 열려 있던 화면은 "capability revision changed"로 생성이 막힌다(10/28 검증 결함 2). View > Reload로는 안 된다.
- **생성 경로.** 데스크톱 앱의 생성은 AI 대화(Codex/Claude CLI)를 거쳐 도구를 호출한다. `./Pankeki.command` 브라우저 경로는 AI 없이 직접 생성한다. 폼의 "Is your stack fully open?"에 Yes라고 답하려면 데모의 핵심 흐름이 AI 대화 없이도 되는 것을 보여 주거나, 대화 패널을 선택 기능으로 설명해야 한다.
- **보여 주지 않을 것.** Blender 영상(품질 미달, 2분 안에 안 들어감), Live2D 재생(SDK 미포함), 부위 자동 분리(미구현), 모델 관리 화면(설정 창과 동일).

## 3. 2분 데모 대본 (오늘 빌드 기준)

원칙: 실제로 동작하는 것만. 대기 구간은 잘라내되 "실시간"이라고 말하지 않는다. 오리지널 캐릭터만. 화면에 개인 경로·메일이 보이면 안 된다.

| 시간 | 화면·조작 | 내레이션(영문) | 상태 |
| --- | --- | --- | --- |
| 0:00–0:08 | 홈 (동결 빌드) | "Pankeki is a local character studio built on ComfyUI. Everything in this video runs on one Mac." | 홈 동결 후 |
| 0:08–0:30 | 템플릿 "고양이 귀" 선택 → 영어 설명 확인 → 생성. 모델 표시(Animagine XL 4.0). 대기 31~55초는 컷, 자막 "~40 s on an M-series Mac, cut for time" | "Pick a template or write a prompt. Pankeki builds the ComfyUI graph and runs it locally with Animagine XL." | 10/30 검증 PASS |
| 0:30–0:42 | 갤러리에서 후보 2개 선택 → "선택한 두 후보 비교" | "Generate a couple of candidates and compare them side by side." | 기능 있음. 녹화 전 후보 2개 준비 |
| 0:42–1:05 | 부분 수정: 목도리에 마스크 → 색 변경(recolor) 즉시 반영 | "Paint a mask and change only that part. Color edits run on the CPU, instantly. Pixels outside the mask are untouched — we test that to zero error." | 10/28 PASS (GPU 0회) |
| 1:05–1:20 | (선택) 같은 방식으로 작은 영역 regenerate. **녹화 전에 같은 마스크·프롬프트로 미리 돌려 결과가 좋을 때만 포함.** 안 좋으면 이 구간을 빼고 아래로 시간 배분 | "Or regenerate the region with SDXL Inpainting — same rule, everything outside stays identical." | 보존은 PASS, 품질은 입력마다 다름(10/30 배경 교체 실패) |
| 1:20–1:35 | 프로젝트 저장 → 앱 종료·재실행 → 프로젝트 열기 → 출력에서 PNG 저장 | "Save the project, reopen it later, export the PNG or a character board." | 10/28, 10/30 PASS |
| 1:35–1:50 | 표정·동작: 미리 준비한 분리 PNG 부위(예: `output/virtual-pancake-20261023` 마스코트)로 눈·입 조절, 짧은 재생, 48프레임 ZIP 내보내기. 자막 "parts prepared manually" | "For motion, Pankeki animates prepared 2D parts — blink, mouth, breathing — and exports PNG frames. Parts are prepared by hand; there is no auto-rigging." | 10/23 48프레임 ZIP 실물 확인 |
| 1:50–2:00 | README의 구조 설명 + 터미널 `./Pankeki.command` 한 줄 | "Under the hood: a small Python server drives ComfyUI's API and records every workflow and model hash. MIT licensed, on GitHub." | — |

녹화 방법: QuickTime 화면 기록(⌘⇧5) 또는 OBS. 앱 창을 1440×900 정도로. 편집은 iMovie로 컷만. 길이 **2:00 이하** 확인 후 YouTube(공개 또는 링크 공개)에 업로드.

녹화 전 체크: `/api/health`의 build 상태 `match`, 모델 3종 설치, 시험용 새 프로젝트 사용(사용자 프로젝트 건드리지 않음), 시스템 알림 끄기, 메뉴 막대의 개인 계정 표시 가리기.

## 4. 제출 폼 입력 (10/28 초안 갱신)

폼: <https://form.typeform.com/to/V1dSQrkS>. 24문항. 개인 정보(Name, Comfy app Email, Country, SNS)는 사용자가 직접.

| 문항 | 입력 |
| --- | --- |
| Project name | `Pankeki` |
| One-line description (≤100자) | `Local ComfyUI character studio: generate, compare, mask-edit and animate original characters` |
| GitHub repo URL | `https://github.com/pullyo/pankeki` |
| Demo video URL | 녹화 후 |
| Live link | 비움 (로컬 Mac 앱) |
| Social post link | 게시 후 |
| Which parts of ComfyUI did you use? | **Comfy API** (로컬 ComfyUI HTTP/WebSocket 직접 연결) |
| Models used | `SDXL 1.0 Base (Stability AI); Animagine XL 4.0 Opt (Cagliostro Research Lab); SDXL Inpainting 0.1 UNet (diffusers). All run locally through ComfyUI.` |
| Other tools or techniques | 10/28 영문 초안 그대로 사용 가능 ([submission-form-20261028.ko.md](../releases/submission-form-20261028.ko.md) "선택 문항 초안") |
| Category | **Open Weights Only** + Most Innovative 후보. FLUX/LTX/MiniMax 해당 없음 |
| Is your stack fully open? | **사용자 결정.** 이미지 생성·수정은 전부 로컬 공개 모델. 데스크톱 대화 패널만 Codex/Claude CLI(비공개). 데모에서 대화를 선택 기능으로 두면 Yes, 핵심 흐름이면 Not sure |
| Agreements 4개 | ① 공개+MIT: 충족 ② SFW·오리지널: 데모 캐릭터가 오리지널인지 사용자 확인 ③ 소개 허용 ④ 1인 1출품 |
| Anything else | 10/28 영문 초안 그대로 |

## 5. 소셜 게시물 초안

**영문 (X / Threads / Reddit 공통)**

> Pankeki — a local character studio built on ComfyUI. Generate original characters, compare candidates, paint a mask and edit only that part (everything outside stays pixel-identical), save and reopen projects, and animate prepared 2D parts. Runs entirely on one Mac with open-weight models (SDXL, Animagine XL, SDXL Inpainting). MIT.
>
> Demo: [YouTube 링크]
> Code: https://github.com/pullyo/pankeki
> #OpenSourceHiggsfield #ComfyUI

**한국어 (선택)**

> Pankeki — ComfyUI 위에서 돌아가는 로컬 캐릭터 작업실. 오리지널 캐릭터 생성, 후보 비교, 마스크로 원하는 부분만 수정(바깥 픽셀은 그대로), 프로젝트 저장·재개, 준비한 2D 부위 움직이기. 공개 가중치 모델로 Mac 한 대에서 전부 실행. MIT.
>
> 데모: [YouTube 링크] · 코드: https://github.com/pullyo/pankeki
> #OpenSourceHiggsfield #ComfyUI

이미지: 홈 화면 스크린샷(`docs/images/pankeki-home-20261030.jpg`) 또는 데모의 편집 전/후 한 장.

## 6. 남은 시간 배분 (제안)

| 시각(KST) | 할 일 | 담당 |
| --- | --- | --- |
| ~13:00 | Codex 동결 시각 회신. 대회 가입 여부 확인 | Claude(검토), 사용자 |
| 동결 즉시 | 앱 재시작, 데모용 시험 프로젝트에 후보 2개 생성, regenerate 미리 시험(1:05 구간 포함 여부 결정) | 사용자 또는 Claude가 앱 조작 |
| ~15:00–17:00 | 녹화 (2~3회 찍고 좋은 것 선택) | 사용자 (Claude가 조작 가능) |
| ~17:00–19:00 | 컷 편집, 길이 확인, YouTube 업로드 | 사용자 |
| ~19:00 | 소셜 게시 (5절 초안) | 사용자 |
| ~20:00 | 폼 입력·제출, 접수 화면 캡처 보관 | 사용자 |
| 20:00–01:00 | 여유 5시간. 이 시간에 기능을 추가하지 않는다 | — |

## 7. 사용자가 정하거나 직접 해야 하는 것

1. 대회 **가입**이 돼 있는지 (공식 페이지 1단계 Sign up).
2. "Is your stack fully open?" 답과 카테고리.
3. 데모 녹화·편집·업로드 (Claude가 앱 조작은 대신할 수 있으나 화면 기록·업로드·게시는 사용자 계정).
4. 소셜 게시.
5. 폼 제출.
