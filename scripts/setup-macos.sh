#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ ! -x .venv-macos-editor/bin/python ]]; then
  python_bin="${PANKEKI_PYTHON:-}"
  if [[ -z "$python_bin" ]]; then
    for candidate in python3.12 python3.13 python3; do
      if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert (3,12) <= sys.version_info < (3,14)' 2>/dev/null; then
        python_bin="$(command -v "$candidate")"
        break
      fi
    done
  fi
  if [[ -z "$python_bin" ]]; then
    candidate="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
    if [[ -x "$candidate" ]]; then python_bin="$candidate"; fi
  fi
  if [[ -z "$python_bin" ]]; then
    echo 'Python 3.12 또는 3.13을 설치하거나 PANKEKI_PYTHON으로 경로를 지정해주세요.' >&2
    exit 1
  fi
  "$python_bin" -m venv --copies .venv-macos-editor
fi
.venv-macos-editor/bin/python -m pip install --cache-dir runtime/macos/pip-cache -r requirements.txt
PANKEKI_SETUP_PYTHON=.venv-macos-editor/bin/python
source scripts/comfyui-vendor.sh
if [[ "${1:-}" == '--generation' || "${1:-}" == '--models' || "${1:-}" == '--sdxl' ]]; then
  ensure_comfyui
  if [[ ! -x .venv-macos/bin/python ]]; then
    .venv-macos-editor/bin/python -m venv --copies .venv-macos
  fi
  .venv-macos/bin/python -m pip install --cache-dir runtime/macos/pip-cache -r requirements-macos.txt
fi
if [[ "${1:-}" == '--sdxl' ]]; then
  .venv-macos/bin/python -u scripts/restore_models_macos.py --model sdxl-base
elif [[ "${1:-}" == '--models' ]]; then
  # SDXL Base + Animagine XL 4.0 Opt + SDXL Inpainting 0.1 UNet (~19 GB), each SHA256-verified.
  .venv-macos/bin/python -u scripts/restore_models_macos.py --model product
fi
if [[ ! -x .tools/photo-tools/vision-foreground-mask ]]; then
  # Optional background-removal helper (Apple Vision); needs Xcode command line tools.
  .venv-macos-editor/bin/python scripts/build_vision_matte.py >/dev/null 2>&1 \
    || echo '참고: 배경 분리 도구를 만들지 못했습니다(Xcode 명령줄 도구 필요). 다른 기능은 그대로 쓸 수 있습니다.' >&2
fi
echo '준비 완료. Pankeki.command를 실행해주세요.'
