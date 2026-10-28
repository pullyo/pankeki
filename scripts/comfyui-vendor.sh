# Sourced by setup-macos.sh. Installs ComfyUI at one pinned upstream commit into
# vendor/ComfyUI. An existing checkout is verified and never overwritten.
# Needs: bash, curl or a working git, and $PANKEKI_SETUP_PYTHON able to import pankeki.

COMFY_COMMIT=8f04fd6ecf4a548937971e840af2a985529fab76
COMFY_REPO="${PANKEKI_COMFY_REPO:-https://github.com/Comfy-Org/ComfyUI}"
COMFY_ARCHIVE_URL="${PANKEKI_COMFY_ARCHIVE_URL:-$COMFY_REPO/archive/$COMFY_COMMIT.tar.gz}"
COMFY_STAGING=''

comfy_cleanup_staging() { if [[ -n "$COMFY_STAGING" ]]; then rm -rf "$COMFY_STAGING"; COMFY_STAGING=''; fi; }

comfy_checkout_commit() {
  local dir="$1/vendor/ComfyUI" head ref
  if [[ -f "$dir/.pankeki-comfy-commit" ]]; then tr -d '[:space:]' < "$dir/.pankeki-comfy-commit"; return 0; fi
  [[ -f "$dir/.git/HEAD" ]] || return 0
  head="$(tr -d '[:space:]' < "$dir/.git/HEAD")"
  if [[ "$head" == ref:* ]]; then
    ref="${head#ref:}"
    if [[ -f "$dir/.git/$ref" ]]; then tr -d '[:space:]' < "$dir/.git/$ref"
    elif [[ -f "$dir/.git/packed-refs" ]]; then awk -v r="$ref" '$2==r {print $1}' "$dir/.git/packed-refs"; fi
  else
    printf '%s' "$head"
  fi
}

comfy_sources_match() {
  "$PANKEKI_SETUP_PYTHON" -c 'import sys; from pankeki.comfy_adapter import _atomic_sources, ATOMIC_CANCEL_SOURCE_PINS as P; sys.exit(0 if _atomic_sources(sys.argv[1]) == P else 1)' "$1" 2>/dev/null
}

comfy_working_git() { command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; }

ensure_comfyui() {
  if [[ -f vendor/ComfyUI/main.py ]]; then
    local found; found="$(comfy_checkout_commit .)"
    if [[ -n "$found" && "$found" != "$COMFY_COMMIT" ]]; then
      echo "vendor/ComfyUI가 다른 commit($found)입니다. 덮어쓰지 않고 중단합니다. 필요한 commit: $COMFY_COMMIT" >&2
      return 1
    fi
    if ! comfy_sources_match .; then
      echo "vendor/ComfyUI의 핵심 파일이 고정 commit $COMFY_COMMIT 과 다릅니다. 덮어쓰지 않고 중단합니다." >&2
      return 1
    fi
    return 0
  fi
  if [[ -e vendor/ComfyUI ]]; then
    echo 'vendor/ComfyUI 폴더가 있지만 main.py가 없습니다. 덮어쓰지 않고 중단합니다. 폴더를 옮긴 뒤 다시 실행해주세요.' >&2
    return 1
  fi
  mkdir -p vendor
  COMFY_STAGING="$(mktemp -d vendor/.comfyui-download.XXXXXX)"
  trap comfy_cleanup_staging EXIT
  mkdir -p "$COMFY_STAGING/vendor"
  local target="$COMFY_STAGING/vendor/ComfyUI"
  echo "ComfyUI $COMFY_COMMIT 내려받는 중…"
  if comfy_working_git; then
    git init -q "$target"
    git -C "$target" remote add origin "$COMFY_REPO.git"
    git -C "$target" -c core.autocrlf=false fetch -q --depth 1 origin "$COMFY_COMMIT"
    git -C "$target" -c core.autocrlf=false checkout -q --detach FETCH_HEAD
  else
    # macOS /usr/bin/git is an Xcode shim that fails until the Xcode license is accepted.
    curl -fsSL --retry 3 -o "$COMFY_STAGING/comfyui.tar.gz" "$COMFY_ARCHIVE_URL"
    tar -xzf "$COMFY_STAGING/comfyui.tar.gz" -C "$COMFY_STAGING"
    mv "$COMFY_STAGING/ComfyUI-$COMFY_COMMIT" "$target"
    printf '%s\n' "$COMFY_COMMIT" > "$target/.pankeki-comfy-commit"
  fi
  if [[ ! -f "$target/main.py" ]] || ! comfy_sources_match "$COMFY_STAGING"; then
    echo "내려받은 ComfyUI가 고정 commit $COMFY_COMMIT 과 일치하지 않습니다. 설치하지 않았습니다." >&2
    comfy_cleanup_staging
    return 1
  fi
  mv "$target" vendor/ComfyUI
  comfy_cleanup_staging
  echo 'ComfyUI 준비 완료.'
}
