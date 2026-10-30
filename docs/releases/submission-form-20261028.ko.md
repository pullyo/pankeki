# 제출 폼 필수 항목과 입력 초안 (2026-10-28 확인)

공식 제출 폼 <https://form.typeform.com/to/V1dSQrkS> 를 읽기 전용으로 열어, 페이지가 이미 내려받은 폼 정의에서 문항을 읽었다. 아무것도 입력하거나 제출하지 않았다. 첫 화면 표기: **"Submit before Friday 10/30 at 9am PT"** (= 10월 31일 01:00 KST). 문항 24개, 조건 분기(logic) 없음.

이 문서에는 이름·메일·국가·계정 같은 개인정보를 적지 않는다. 해당 칸은 제출자가 폼에서 직접 입력한다.

## 문항과 초안

| 문항 | 필수 | 초안 / 상태 |
| --- | --- | --- |
| Name | 필수 | 제출자 직접 입력 (공개 표기용 이름) |
| Comfy app Email | 필수 | 제출자 직접 입력. **Comfy 앱 계정 메일**을 묻는다. 결과·상품 배송 연락용 |
| Country | 필수 | 제출자 직접 입력 |
| Social handles / Discord / Reddit | 선택 | 제출자 판단 |
| How familiar were you with ComfyUI before this challenge? | 필수 | 5지선다: Never used it / Tried a few times / Used it regularly / Use it professionally / I build custom nodes or contribute. 제출자 판단 |
| Project name/title | 필수 | `Pankeki` |
| One-line description (100자 이하) | 필수 | `Local ComfyUI character studio: generate, compare, mask-edit and animate original characters` (92자) |
| GitHub repo URL | 필수 | `https://github.com/pullyo/pankeki` — **공개 + 오픈소스 라이선스 + 설치 안내가 조건.** 현재 GitHub main(`943513c`)은 10/20 상태라 최신 소스·LICENSE·영문 README 반영(push)이 먼저 필요 |
| Demo video URL (2분 이하) | 필수 | **미준비.** 아래 대본으로 녹화 후 공개 링크 필요. 설명: "빌드가 동작하는 모습과 어떻게 만들었는지" |
| Live link to try it | 선택 | 로컬 Mac 전용 앱이라 비워 둠. 공개되지 않으며 심사 기간 5~10회 실행 예상이라고 안내됨 |
| Social post link tagging #OpenSourceHiggsfield | **필수** | **미준비.** X/IG/Reddit/TikTok 등에 `#OpenSourceHiggsfield` 태그 게시 후 링크 |
| Which parts of ComfyUI did you use? | 필수 | 선택지: Comfy API / Comfy Router / Comfy SDK / Comfy Cloud Agent / Comfy MCP. 현재 Mac 앱은 로컬 ComfyUI의 HTTP·WebSocket API를 직접 쓰므로 **Comfy API**. (Windows 시절 comfy-sdk 경로는 현재 지원 경로가 아니므로 표기하지 않는 것을 권장) |
| List all generative models used | 필수 | `SDXL 1.0 Base (Stability AI); Animagine XL 4.0 Opt (Cagliostro Research Lab); SDXL Inpainting 0.1 UNet (diffusers). All run locally through ComfyUI.` |
| Other tools or techniques used | 선택 | 아래 초안 |
| Category | 필수 | 선택지: Most Innovative / Most Viral / Open Weights Only / Built with FLUX 3 Bonus / VFX Built with LTX Bonus / Built with MiniMax H3 Bonus. 앱이 쓰는 모델이 모두 공개 가중치이므로 **Most Innovative + Open Weights Only** 후보. FLUX 3·LTX·MiniMax는 앱에서 쓰지 않으므로 해당 없음 |
| Is your stack fully open? | 필수 | Yes / No / Not sure. 정의: "모든 모델·노드·의존성이 공개 가중치/오픈소스이고 **핵심 경로에 비공개 API 모델이 없음**". 이미지 생성·수정 경로는 전부 로컬 공개 모델이다. 데스크톱 채팅 패널은 Codex/Claude CLI(비공개 모델)를 쓰지만 선택 기능이다. **판단 필요:** 채팅을 데모·설명에서 선택 기능으로 명시하면 Yes, 채팅이 핵심 흐름으로 보이면 Not sure가 정직하다 |
| Agreements | 필수 | 4개 모두 동의해야 자격: ①저장소 공개+오픈소스 라이선스 ②합법·SFW·무단 IP/실존 인물 초상 없음 ③Comfy·Runpod·LTX·BFL·MiniMax의 소개 허용(Creator Feature Terms) ④1인 1출품. ①은 push 후 충족, ②는 데모 이미지가 오리지널 캐릭터인지 확인 필요 |
| Anything else | 선택 | 아래 초안 |

## 선택 문항 초안 (영문)

**Other tools or techniques used**

> Pankeki is a standard-library Python server in front of a local ComfyUI. It builds ComfyUI API graphs for
> txt2img, img2img and SDXL inpainting, plans region-of-interest crops for small masks, and composites
> results so pixels outside the mask and the original alpha are preserved exactly (tested to zero error).
> Color-only edits run as a CPU recolor with no model call. Every job records its workflow, inputs, model
> SHA256 and timings, and results are re-verified before they are served. The UI is a single-file web app
> with a 2D rig and motion editor (PNG / 48-frame export), wrapped in an optional Electron shell whose chat
> panel can call the same generate/edit tools; the same API is also exposed as MCP tools.

**Anything else**

> Everything runs on one Apple Silicon Mac (tested on an M6 with 32 GB). The optional chat panel uses the
> Codex or Claude CLI under the user's own account; image generation never leaves the machine.
> Live2D/Cubism playback is not included because the official SDK cannot be redistributed.

## 2분 데모 대본 (녹화용)

원칙: 실제로 동작하는 것만 보여 준다. Live2D 재생, 부위 자동 분리 등 준비 전 기능은 시연하지 않는다. 생성 대기 시간은 편집으로 줄이되 "실시간"이라고 말하지 않는다. 오리지널 캐릭터만 사용한다.

| 시간 | 화면 | 내레이션(요지) |
| --- | --- | --- |
| 0:00–0:08 | 홈 화면, 로고 | "Pankeki: a local character studio on ComfyUI. Everything runs on this Mac." |
| 0:08–0:28 | 이미지 생성에 영어 설명 입력 → 후보 생성(대기 구간 컷) | 모델 선택(SDXL Base / Animagine) 보여 주기 |
| 0:28–0:40 | 후보 비교, 하나 선택 | "Compare candidates, keep the one you like." |
| 0:40–1:00 | 부분 수정: 브러시로 마스크 → regenerate 결과 | "Paint a mask and regenerate only that part. Everything outside the mask stays pixel-identical." |
| 1:00–1:12 | 같은 영역 recolor | "Color-only changes run instantly on the CPU, no model call." |
| 1:12–1:25 | 저장 → 새로고침 → 프로젝트 다시 열기, 보드 PNG 내보내기 | 저장·재개 |
| 1:25–1:40 | 표정·동작 편집기에서 준비된 리그로 짧은 동작 재생, 48프레임 내보내기 | 2D 움직임 |
| 1:40–2:00 | 구조도(README의 How it works) + 터미널에서 `./Pankeki.command` | "How it's built: a small Python server drives ComfyUI's API; each run records its workflow and model hashes. Open source, MIT." |

녹화 전 확인: 앱을 `./Pankeki.command`로 재시작해 최신 코드로 실행 중인지(`/api/health`의 build status `match`), 모델 3종이 설치돼 있는지, 화면에 개인 경로·메일이 보이지 않는지.

## 제출 전 남은 사용자 결정·행동

1. 최신 소스를 GitHub에 반영(push)할지와 공개 범위. 내부 팀 문서(`docs/team-macos-20261022/` 등)에 이 Mac의 사용자 이름·경로가 남아 있어 공개 전 제외나 정리 여부를 정해야 한다.
2. 데모 녹화와 업로드(공개 링크).
3. `#OpenSourceHiggsfield` 소셜 게시.
4. "Is your stack fully open?"과 카테고리 선택.
5. 개인 정보 항목 입력과 최종 제출(제출자 본인).
