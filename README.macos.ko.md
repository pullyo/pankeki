# Mac에서 Pankeki 실행

프로젝트 폴더의 **Pankeki.command**를 더블클릭한다. 브라우저 주소는 http://127.0.0.1:8190 이다. 종료는 실행된 터미널에서 **Control+C**를 누른다. 기본 실행은 SDXL 1.0 Base를 사용하는 이미지 생성·부분 수정과 기존 편집·움직임 기능을 함께 제공한다.

터미널에서 실행할 때:

```bash
./Pankeki.command
# 브라우저를 자동으로 열지 않고 실행
./Pankeki.command --no-browser
# 생성 서버를 시작하지 않고 편집·움직임만 실행
./Pankeki.command --editor-only
```

이 백업의 Windows 가상환경과 설정은 보존돼 있다. Mac 생성 환경은 `.venv-macos`, 독립 편집 환경은 `.venv-macos-editor`이다. 두 모드 모두 Mac용 `runtime/macos/config.json`을 사용한다. 실행할 때 현재 프로젝트 경로로 설정을 생성하므로 외장 드라이브 이름에 공백이 있어도 작동한다. Python 가상환경 자체를 다른 위치로 옮기면 다시 구성해야 한다.

이미지 생성 화면에서 **SDXL 1.0 Base**를 선택하고 설명을 입력한 뒤 **캐릭터 후보 생성**을 누른다. 기본값은 1024×1024, 25 steps, CFG 6, DPM++ 2M / Karras이다. 영어로 외형과 색상을 구체적으로 적는 것을 권장한다.

후보의 **이어서 수정**을 누르거나 원본을 업로드하고, 바꿀 부분을 브러시로 칠한 뒤 수정 설명과 함께 **선택 영역 수정**을 누른다. 같은 SDXL 체크포인트에 마스크와 원본을 전달하는 방식이다. 최종 합성에서 마스크 밖 픽셀과 원본 alpha를 보존한다. 수정 결과의 외형과 색상은 직접 확인한다.

수정 강도가 낮으면 원본의 색상을 강하게 유지할 수 있다. 강도를 높이면 색상뿐 아니라 형태도 달라질 수 있으므로, 같은 원본에서 후보를 비교한다. 이 SDXL Base 연결은 원본의 특정 색상만 정확히 교체하는 기능을 보장하지 않는다.

백업에는 모델 가중치가 없었다. 새 Mac에서 편집기의 필수 패키지만 설치할 때:

```bash
bash scripts/setup-macos.sh
```

생성 의존성과 SDXL 1.0 Base를 함께 설치할 때:

```bash
bash scripts/setup-macos.sh --sdxl
```

앱이 쓰는 세 모델(SDXL Base, Animagine XL 4.0 Opt, SDXL Inpainting 0.1 UNet, 약 19GB)을 모두 설치할 때:

```bash
bash scripts/setup-macos.sh --models
```

생성 옵션(`--generation`, `--sdxl`, `--models`)은 ComfyUI가 없으면 고정 commit `8f04fd6e…`을 `vendor/ComfyUI`에 내려받는다. 동작하는 git이 없으면 curl로 받으며, 핵심 파일 해시가 맞지 않거나 다른 commit의 기존 폴더가 있으면 덮어쓰지 않고 중단한다.

SDXL 파일은 `models/checkpoints/sd_xl_base_1.0.safetensors`에 둔다. 공식 Stability AI 저장소의 고정 revision에서 이어받고, SHA256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b`와 일치해야 활성화한다. SD Turbo는 이 설치 명령의 다운로드 대상이 아니다. 설치된 Mac 패키지 버전은 `requirements-macos-lock.txt`에 기록했다.

ComfyUI는 Apple Silicon의 PyTorch MPS/Metal에서 실행한다. UNet·텍스트 인코더는 FP16, VAE는 FP32를 사용한다. 모델을 메모리에 읽는 첫 생성에는 준비 시간이 포함된다. 실제 생성·부분 수정 검증 이미지와 수치는 `runtime/macos/sdxl-verification/`에 저장한다.

2026-10-22 실제 앱 API 검증: 1024×1024 / 25 steps 새 이미지 42.24초(첫 모델 로드 포함), 마스크 수정 28.16~30.17초. 네 번 모두 실제 denoiser가 실행됐고 미리보기 25장이 전달됐다. 세 번의 수정에서 마스크 밖 RGB 오차와 alpha 오차는 모두 0이었다. 기본 모델에서 수정 강도 0.65 / 0.9 / 1.0의 결과를 비교했으며, 마지막 결과는 목도리 색상과 형태가 함께 바뀌었다. 측정값은 이 Mac의 해당 요청 결과이며 일반적인 속도 보장이 아니다.

Windows 전용 SDK 실행 경로·저장된 PID·Windows 읽기 잠금은 사용하지 않는다. Mac의 direct 연결에서는 정확 결과 캐시를 우회한다. 생성 모델이 없어도 부위 편집, 움직임, 프로젝트 저장, 정지 PNG·48프레임 ZIP 출력은 사용할 수 있다. 기존 Windows 추론 속도 기록은 이 Mac의 성능으로 간주하지 않는다. 이전에 중단했던 다른 모델의 부분 다운로드 파일은 보존했다.

로그: `runtime/macos/app.log`, `runtime/macos/comfy.log`.
ComfyUI 입출력·사용자 데이터: `runtime/macos/comfy-*`.
원본 Windows 설정: `runtime/config.json`.
백업 해제 기록: 상위 폴더 `extraction-result.json`.

기존 로컬 API는 127.0.0.1에만 열린다. 서버는 로그인·재부팅 시 자동 시작하도록 등록하지 않았다. 원래 미완료 기능과 디자인 시안은 이번 복원으로 완료 처리하지 않는다.
