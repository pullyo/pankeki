# 도구 설치와 실제 사용 인계

2026년 10월 20일 한국시간 · 아지 총괄

사용자가 필요한 GitHub 도구의 설치·사용과 `https://github.com/morluto/rea`의 설치·적용을 요청했다. 공식 REA6.7.0과 npm11.16.0을 `D:/Pankeki/.tools/rea`에 고정 설치했다. 전역 Node/npm을 교체하지 않았다. 의존성은 `package.json`과 `pnpm-lock.yaml`에 남아 있다.

공용 실행 명령은 `D:/Pankeki/.tools/bin/rea.cmd`다. `--version`으로6.7.0을 확인했다. 런타임 임시 경로는 `D:/Pankeki/.tools/rea-runtime`을 사용한다. 공개 소스 저장소의 일반 분석은 기존 파일 도구를 사용하고, REA는 설치된 앱과 패키지의 정적 증거에 사용한다.

Codex 설정은 REA의 read-only 계획을 먼저 확인한 뒤 공식 setup으로 적용했다. `C:/Users/Administrator/.codex/config.toml`의 REA 등록은 `aligned`, 전용 스킬은 version42/tool_count207 및 `aligned`로 확인됐다. 설정 백업은 `C:/Users/Administrator/.codex/config.toml.rea.backup`, 스킬은 `C:/Users/Administrator/.agents/skills/reverse-engineer-anything`이다. 기존의 다른 설정을 보존하는 setup을 사용했다. 등록 검증과 현재 채팅의 MCP 도구 연결은 별개이며 이번 실제 분석은 CLI로 수행했다.

## REA 실제 분석

| 대상과 검사 | 결과 |
| --- | --- |
| `C:/Program Files/Live2D Cubism 5.3/CubismEditor5.exe`의 `inspect-pe-resources` | exit0, PE 정적 리소스18개. evidence `ev_c5eae37b12ffa149ed7344ff15456dd667259c67ec34006603812c34fd2f9006` |
| `C:/Program Files/Live2D Cubism 5.3/app/lib/Live2D_Cubism.jar`의 `inspect-artifact` | exit0, ZIP 정적 패키지 검사. evidence `ev_e1967459de1ebd42bd40dca4cdcc55a0a881f2e8ff3a6ca4f9b4038f13a360c8` |

`work/team-resume/tooling/rea-setup.json`, `live2d-pe-evidence.json`, `live2d-jar-evidence.json`에 원본 결과가 있다. 이 검사는 프로그램 실행·Java 코드 복원·변형 알고리즘 검증이 아니다. Live2D 기능 분석은 공식 문서와 공개 SDK 근거를 별도로 결합했다.

## 앱과 Comfy SDK 환경

환경 담당이 `.venv`의 앱3개와 `integrations/comfy-sdk/.venv`의 기존 SDK lock23개를 복원했다. comfy-sdk0.5.0·comfy-api-proxy0.1.6의 공식 GitHub 태그와 보존된 wheel SHA256을 대조했다. SDK 브리지12개를 포함해 기존 검사198개 중197개가 통과했고 Windows symlink 권한에 따른 skip1개가 남았다. 실제 SDK의 오프라인 workflow 객체와 proxy CLI 사용도 확인했다. 아지가 SDK `pip check`의 정상 종료를 별도 확인했다.

설치 명령·패키지·로그·한계는 [환경 담당 인계](resume-qa-tooling.md)에 있다. 모델 가중치와 전체 Comfy/CUDA 환경은 복원하지 않았으므로 실제 GPU 생성 성공으로 확대하지 않는다.
