# Mac 실행·배포 준비 인수인계

작성일: 2026-10-22 KST · 담당: Pankeki Mac 출시 엔지니어
프로젝트 루트: `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki` (이하 근거 경로는 이 루트 기준).
운영 기준: `docs/TEAM-MACOS-20261022.ko.md`. Windows 팀 기록과 과거 편집 전용 복원 계획을 현재 완료 범위로 사용하지 않았다.

## 역할과 준비 상태

Mac 실행기, 실행 환경, 사용자 설치·실행 안내와 배포 준비를 담당한다. 이번에는 소스·설정·파일 메타데이터만 직접 확인했다. 현재 프로세스 가동 여부, Python 실행 가능 여부, 모델 해시·추론·사용자 동작을 재검증하지 않았다. **현재 Mac의 로컬 복원 성공 기록은 있으나, 다른 Mac에 전달할 배포물의 준비 완료를 입증하는 자료는 이번 검토 범위에서 확인하지 못했다.**

## 이번에 직접 확인한 구현과 근거

- **실행기:** `Pankeki.command:3-14`는 자기 폴더로 이동하고, 생성용 `.venv-macos/bin/python`이 실행 가능하면 우선 선택한다. `--editor-only`는 `.venv-macos-editor/bin/python`을 명시 선택하며 인자를 전달한다. 실행 파일 권한과 두 Python 파일의 존재를 확인했다.
- **서버 운영:** `scripts/run_macos.py:44-139`는 앱 8190·ComfyUI 8188 포트를 먼저 검사하고 Mac 설정·모델 경로를 실행 시 생성한다. torch 또는 등록 체크포인트가 없으면 편집 모드로 전환한다. 생성 시 ComfyUI를 localhost·offline·커스텀 노드 비활성으로 실행하고 MPS fallback, UNet/텍스트 FP16·VAE FP32를 지정한다. 준비 응답 대기, 로그, PID 기록, Control+C/SIGTERM 이후 자식 종료 처리가 구현돼 있다. 해당 동작을 이번에 실행한 것은 아니다.
- **환경·외부 자산:** 두 `pyvenv.cfg`는 Python 3.12.14와 `/Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin`을 참조한다. `vendor/ComfyUI/`와 SDXL 파일 `models/checkpoints/sd_xl_base_1.0.safetensors` 6,938,078,334바이트가 존재한다. SD Turbo 최종 파일은 없으며 이번 준비의 필수 모델로 간주하지 않는다. 파일 존재·크기는 확인했지만 해시는 다시 계산하지 않았다.
- **설치·안내:** `README.macos.ko.md`는 더블클릭 실행, `--no-browser`, 편집 모드, Control+C, 로그와 venv 이동 시 재구성을 안내한다. `scripts/setup-macos.sh:4-32`는 Python 3.12/3.13 탐색 또는 `PANKEKI_PYTHON`, Codex 경로 fallback을 사용한다. 기본은 편집 의존성, `--sdxl`은 생성 의존성과 모델을 설치한다. 실제 설치 입력은 `requirements.txt`·`requirements-macos.txt`이며 `requirements-macos-lock.txt`는 직접 사용하지 않는다. `scripts/restore_models_macos.py`는 고정 revision·분할 이어받기·완성 파일 SHA256 검증을 구현한다.

## 기존 검증 기록에서 확인한 범위

`runtime/macos/restore-status.json`의 2026-10-22 기록은 arm64/MPS에서 SDXL 생성·마스크 편집의 실제 denoiser 실행, 마스크 밖 RGB·alpha 오차 0, 편집·모션·저장·PNG·48프레임 ZIP 완료 UI를 보고한다. Python은 94통과/20제외, JS는 142통과/1제외/1TODO 기록이다. `runtime/macos/sdxl-integrity.json`은 SDXL SHA256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b` 일치와 과거 Range 다운로드 불일치 후 Hub/Xet 복구를 기록한다. 이번에 새로 얻은 실행·테스트 결과가 아니다.

최신 UI 범위와 한계는 `runtime/macos/pc-chat-ui/verification.json`·`review.md`를 따른다. Python 검증은 이전 복원 단계 기록이며 UI 단계에서 재실행되지 않았다. macOS 다운로드 파일의 실제 도착, 실제 작업 중 취소, VoiceOver·전체 고배율 흐름은 미검증이다. 기존 로고·11개 메뉴·생성/마스크/프로젝트/모션/출력은 보존 대상이다.

## 미확인 사항과 다음 작업 우선순위

새 Mac의 최소 OS·메모리·여유 공간과 지원 기종, 사용자별 Python 경로 없이 설치·이동하는 절차, 배포 형식·모델 제공 방식·서명/공증·업데이트·제거 절차는 확정 근거가 부족하다. 현재 설치기는 Range 다운로드를 사용하므로 과거 Hub/Xet 복구 성공만으로 신규 설치 성공을 보장할 수 없다. 실행 시 프로젝트 내부에 설정·로그·생성 데이터를 쓰는 구조도 향후 패키지 배치와 함께 검토해야 한다.

| 우선 | 다음 배정 제안 | 완료 기준 |
|---|---|---|
| 1 | 새 Mac 설치 재현성 정리 | 독립 Python 준비, 두 venv·ComfyUI 버전 고정, lock 적용 방침, SDXL 무결성 실패·이어받기 복구를 문서화하고 별도 배정된 깨끗한 환경에서 설치 버전·최종 모델 해시 증거 확보. |
| 2 | 실행·종료·사용자 출력 검증을 QA와 조율 | 기본/편집 실행, 공백 경로·이동 후 재구성, 환경/모델 누락, 점유 포트, 시작 실패·종료 시 자식 정리와 실제 PNG/ZIP 파일 도착을 확인한 기록 및 안내 확보. |
| 3 | 배포 사양과 출시 판단 기준 작성 | 폴더 배포 또는 앱 패키지 선택, 지원 환경·자산 제공·데이터 저장·서명/공증 필요 범위·업데이트/제거 절차와 검수 항목을 총괄 검토 가능한 문서로 확정. 실제 패키징·설치·공개는 후속 배정 범위로 구분. |

## 변경 파일과 작업 범위

변경 파일은 `docs/team-macos-20261022/handoffs/mac-release.md` 한 개다. 제품 코드·공통 문서·다른 담당 파일은 수정하지 않았다. 테스트·빌드·브라우저·추론·다운로드·설치·패키징·프로세스 변경·외부 게시·추가 채팅/하위 에이전트 생성·다른 채팅 메시지 발송은 수행하지 않았다. 다음 배정을 기다린다.
