# Liquid Glass phase1 — 실제 화면 캡처와 가벼운 QA

2026-10-20 KST · QA 별도 세션 · **가벼운 동작 확인15/15 통과 / 실제 스크린샷10장**

**기존 배치의 재질·서체를 바꾼 phase1 중간본이다. 새 배치 완성이나 전체 디자인/제품 수용을 뜻하지 않는다.** 실제 캡처 시각은17:11:35~17:11:38 KST다.

- 실제 origin: `http://127.0.0.1:8198/`
- 응답 본문/응답 헤더/캡처 종료 시 디스크 HTML SHA256: **`9775d085d1f4efb82c57f11e1ccb64f8768967a2b5827183d05b59f9d23487a8`**
- 실제 브라우저: 설치된 Chrome150.0.7871.47, headless. 데스크톱1440×1040·모바일390×844, DPR1.
- 증거 루트: `D:/Pankeki/work/design/liquid-glass-20261020/evidence/qa-phase1-9775d085/`
- 응답 HTML을 `loaded-phase1.html`에 보존했다. phase1 스타일은 이 응답 HTML의 추가 inline CSS에 있으며 이번 판정은 위 로드 SHA에 한정한다.

## 확인한 범위

| 확인 | 실제 결과 |
|---|---|
| 주요 이동/버튼 | 디자인→부위→팬케이크 예제→표정·동작→출력 이동 성공. 실제 캐릭터3부위가 준비됐고 재생/정지 버튼이 동작했다. PNG/ZIP 버튼은 보이기만 확인하고 출력/다운로드는 실행하지 않았다. |
| 스크롤 | 데스크톱 부위 패널 내부와 모바일 페이지를 실제 wheel로 내려 아래 조절부에 도달했다. 모바일 document 가로 넘침 없음(390px). |
| 문자 | 캡처를 원본 해상도로 직접 확인했다. 시스템 서체의 한글 제목·본문·입력값이 읽히고 글자에 foreground blur가 없다. 실제 family는 `-apple-system, BlinkMacSystemFont, Segoe UI, Malgun Gothic, sans-serif`; 주요 파라미터 label15px/line-height24px. 정식 접근성/대비비 전체 검사는 이번 범위 밖이다. |
| 캐릭터 | 실제 Canvas와 모든 조상의 `filter:none`, Canvas opacity1. 글래스의 backdrop blur가 캐릭터 전경에 적용되지 않는다. 눈·입·외곽선은 캡처에서 식별된다. |
| 기본 글래스 | 헤더 background alpha.73 + blur26px, 패널 alpha.91 + blur22px가 실제 computed style에 반영됐다. |
| 단색 fallback | 제공된 `html[data-solid-surfaces]` 테스트 hook을 QA DOM에만 적용했을 때 패널은 `rgb(255,252,247)`/backdrop-filter none으로 바뀌었다. 실제 캡처에서 글자·캐릭터·조절부가 유지됐다. |
| 대비 강화 fallback | 브라우저의 `prefers-contrast:more` 에뮬레이션이 실제로 match됐고 같은 불투명 표면/blur none이 적용됐다. |
| 오류/경계 | page exception0, 다운로드0, 요청은8198 GET만 있었다. API models/health503은 정적 preview의 격리 상태이며 생성 서버 성공으로 세지 않았다. |

기본 브라우저는 backdrop-filter를 지원하므로 **실제 미지원 엔진의 `@supports not` 분기는 실행하지 않았다.** reduced-transparency OS 설정도 별도 검증하지 않았다. fallback에 대한 이번 통과는 제공된 단색 hook과 대비 강화 media 조건에 한정한다.

## 시각 관찰 — 차단 아님

- 데스크톱 캐릭터 Canvas의 native640×640이 CSS660×660으로 확대 표시된다. 임의 foreground blur는 없지만 확대 보간 조건이다. 최종 배치의 선명도 검토에서 이 크기 차이를 함께 확인할 수 있다.
- 1040px 높이의 데스크톱 첫 화면에서 transport 아래 seek 일부가 화면 아래에 놓인다. 모바일은 캐릭터→transport→조절 패널 순으로 스크롤되며 주요 조절부가 이어진다. phase1 배치의 관찰이며 새 배치 완료 판정은 하지 않는다.

## root·디자인 담당이 바로 볼 캡처

증거 루트 아래 다음 PNG를 실제 브라우저에서 저장했다.

| 파일 | 내용 |
|---|---|
| `desktop-design.png` | 데스크톱 디자인 화면의 문자/표면 |
| `desktop-motion.png` | 실제 캐릭터와 글래스 패널 기본 화면 |
| `desktop-parts-scrolled.png` | 부위 패널 내부 스크롤 |
| `desktop-solid-fallback.png` | 제공된 단색 표면 fallback |
| `desktop-contrast-fallback.png` | 대비 강화 조건 fallback |
| `desktop-export.png` | 출력 화면과 주요 버튼 |
| `desktop-home.png` | 데스크톱 시작 화면 |
| `mobile-home.png` | 모바일 시작 화면 |
| `mobile-motion-top.png` | 모바일 실제 캐릭터 화면 |
| `mobile-motion-scrolled.png` | 모바일 스크롤 후 조절부 |

`phase1-light-qa.json`에 각 캡처 SHA, origin/build, 실제 computed styles와 동작 결과를 보존했다. `qa-evidence-manifest.json`은 증거 파일별 SHA/크기다.

별도 신규 headless 세션만 사용했다. 사용자 foreground 탭, QA8197 및 기존 다운로드 증거는 조작하지 않았으며8198 서버도 중단하지 않았다. 새 설치/패키지/권한 우회/생산 코드 수정, 단위·픽셀·모델·완료 suite/영상/다운로드 재검수는 없다.
