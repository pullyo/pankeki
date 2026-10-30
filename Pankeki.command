#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
python_bin='.venv-macos-editor/bin/python'
if [[ -x .venv-macos/bin/python ]]; then
  python_bin='.venv-macos/bin/python'
fi
for argument in "$@"; do
  if [[ "$argument" == '--editor-only' ]]; then
    python_bin='.venv-macos-editor/bin/python'
    break
  fi
done
exec "$python_bin" scripts/run_macos.py "$@"
