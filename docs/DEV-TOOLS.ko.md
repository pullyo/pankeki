# Mac 개발 도구

사용자 요청으로 공식 GitHub 안정 릴리스에서 설치하고 실제 정적 검사·구조 검색에 사용했다. 설치 위치는 프로젝트의 `.tools/codex-quality-tools/`이며 전역 PATH·Python·기존 venv는 변경하지 않았다.

| 도구 | 버전 | 공식 출처 | 실행 파일 |
|---|---|---|---|
| Ruff | 0.17.1 | https://github.com/astral-sh/ruff | `.tools/codex-quality-tools/bin/ruff` |
| ast-grep | 0.51.0 | https://github.com/ast-grep/ast-grep | `.tools/codex-quality-tools/bin/ast-grep` |

프로젝트 루트에서 실행한다. 검증된 예:

```sh
.tools/codex-quality-tools/bin/ruff check --isolated --no-cache --no-fix --target-version py312 --select E9,F63,F7,F82 pankeki
.tools/codex-quality-tools/bin/ast-grep run --lang javascript --pattern 'Design.buildPrompt($BRIEF, $MODE)' --json=compact web/src/app.js
.tools/codex-quality-tools/bin/ast-grep run --lang python --pattern 'ImageOps.invert($MASK)' --json=compact pankeki/engine.py
```

Ruff는 변경 파일의 필요한 규칙부터 읽기 전용으로 확인한다. 기존 코드 전체를 자동 수정하거나 구조 검색 결과만으로 결함·품질 합격을 판정하지 않는다. 실제 이미지·실행·회귀 검증은 별도로 수행한다.

공식 배포 아카이브의 게시 SHA256, 선택 자산, 라이선스와 설치 검증 및 실제 사용 결과는 [도구 설치·사용 인계](team-macos-20261022/quality/mac-tooling.md) 및 `.tools/codex-quality-tools/evidence/`에 있다. 기본 Ruff 검사에서 발견한 기존39건과 제한된 오류 검사0건의 범위를 구분한다. 무결성 해시 대조는 별도 서명·attestation 검증을 뜻하지 않는다.
