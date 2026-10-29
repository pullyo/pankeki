# 첫 실제 움직임 시연 — 디자인 인계

최신 표시 화면은 **http://127.0.0.1:8197/** / 공유 HTML SHA256 `435515fb7e4b436f1496622eac99f599bdd9bc04b3b17f47f1580aee9b4adc32`다. controller269bc88e… 후속 영향16개 통과 후 원래 web/build.py로 공유 HTML을 빌드했고8197후보와 일치한다. 사용자의 실제 활성 탭2CB205…에서 예제를 연속 재생해 hidden=false/playing=true/error=''를 확인하고 화면을 그대로 두었다. 아래 최초8196 HTML과 영상은 **증거 동결 유지**다. 후속 source/빌드/영향 검사·foreground 소유 기록은 `motion-design-integration.md` 최신 절을 참조한다.

2026-10-20 KST. 사용자의 즉시 시연 요청에 따라 실제 앱의 **예제 로드→재생→시간별 눈·호흡 변화→정지**를 녹화했다. 첫 시연 파일과8196빌드는 동결하며 후속 수정본으로 덮어쓰지 않는다. root/QA는 아래 미디어와 정확한 입력을 그대로 사용할 수 있다. 다른 채팅에 메시지를 보내는 대신 이 파일로 인계한다.

- 즉시 표시할 미디어: `D:/Pankeki/work/team-resume/design/motion/pankeki-first-motion.webm` · 640×640 VP9 WebM · 587,048bytes · SHA256 `6d6dc6270519f19e35d41f2e0f91ad5e1daa146cc302c56ad19de3b966532c99`. native Canvas.captureStream/MediaRecorder로 **실제 재생 중인 canvas**를 약5.5초 녹화했다. 사전 프레임 시퀀스나 영상 대체 캐릭터가 아니다.
- 실제 접근 origin: `http://127.0.0.1:8196/`. route fulfillment가 아닌 실행 중인 localhost HTTP 서버다. Node PID30916 / exec session78557, 재시작은 `node work/team-resume/design/motion/serve-first-motion.cjs`. HTML 바이트를 시작 시 고정하고 X-Pankeki-Build-Sha256 header로 노출한다. static preview이므로 모델/생성 backend는 연결하지 않는다.
- HTML: `work/team-resume/design/motion/first-motion-preview/index.html` · 2,419,338bytes · SHA256 `6d3170a448c1544c4617e02fc364cea6c5ce190914fb6a1eabea006a45f30458`. 입력 전체는 `first-motion-inputs.json`, build log는 `first-motion-build.log`다.
- controller `6c9f25041efe41bd5a70811b16efc92f146c65b46227eb1aff6617c0154b632a`, renderer `70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae`. 프론트 preview-snapshot 및 root 수집 렌더러와 일치함을 확인한 후 **한 시점 입력**으로 빌드했다.
- 공개 재현: 부위→팬케이크 예제→표정·동작→재생. 구형8196에서 반복 재생 시 선택이 비는 PLAY001을 피하려면 곡선 도구에서 실제 저장 동작 `눈 깜빡임과 호흡 (blink-breath)`을 먼저 선택한다. 프론트가 PLAY001/INIT001을 별도253f20… 수정본으로 인계했고 첫 시연은 이 두 수정의 검증으로 확대하지 않는다.

`node work/team-resume/design/motion/record-first-motion.cjs`의 실제 Chrome/HTTP 결과는 `first-motion-browser.json` **9/9**, pageerror0, 생성/쓰기 요청0이다. 4.763초의68개 관찰에서 eyeOpen0.004..1, breath0.0001..0.9887, 서로 다른 실제 canvas pixel hash를 확인했다. 재생 중 revision0 유지, 실제 정지 버튼 후 revision1/값 유지650ms도 확인했다. native WebM을 브라우저에서 다시 디코드해 .25/1/1.5/2.9초의640² 네 프레임이 서로 다름을 확인하고 PNG를 보존했다.

기본 화면과 원본 source.png의 RGBA 다른 채널0이다. 이는 해당 기본 pose의 이음새 수정 확인이며 전 형태/사용자 PNG/전체 alpha 품질 수용을 대신하지 않는다. `first-motion-ready.png`, `first-motion-playing.png`, `first-motion-paused.png`, `first-motion-video-*.png`를 직접 열어 확인했다. 최초 캔버스 영상에는 시스템 오디오나 대화가 없다.

프론트와 실제 Aside 사용자 탭을 함께 제어할 때 화면 전환이 섞여 pause/초기화가 생겼다. 이후 프론트가 **사용자 foreground 탭 제어는 디자인만 담당**한다고 인계했다. 기존 시연 탭을 후속 검사의 대상으로 사용하지 않고 후속 검사는 headless의 별도 origin에서 실행한다. foreground가 숨겨지면 정책대로 pause되므로 다른 앱/탭으로 넘어갔을 때 자동 재생 중이라고 주장하지 않는다.

후속 `253f20…`은 별도 snapshot/origin에서 빈 시작과 play→pause→play→pause만 검증한다. 저장/48ZIP/취소/한도/사용자 소재/성능 전체 T9는 QA가 계속 맡으며 시연용 중복 녹화를 추가하지 않는다. 공유 `web/index.html`의 최종 빌드/해시는 후속 결과에 이어 기록한다.

후속 확정:253f20…은 중간본이며 실제로 소비한 최종 source는269bc88e…다. `motion-followup-preview/`, `motion-followup-inputs.json`, `motion-followup-browser.json`16pass, `shared-build-manifest.json`이 최신 결과다. 실제 origin8197의 고정 HTML과 공유web/index.html은435515fb…adc32로 일치한다. 최초 영상 재녹화 없이 T9 나머지를 QA에 넘겼다.
