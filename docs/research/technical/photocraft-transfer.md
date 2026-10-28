# PhotoCraft 기술과 Pankeki 적용 제안

2026-10-20 KST 확인. [공식 ArtCraft 제품 페이지](https://getartcraft.com/apps/photocraft)의 GitHub 링크와 [저장소 README](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/README.md)의 제품 링크가 서로 연결된다. 조사 기준은 [commit 3a896a5](https://github.com/storytold/photocraft/commit/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3)이다. **Pankeki에 우선 참고할 기술은 명령 규격과 편집 이력 구조다.** Rust 엔진 이식은 제안하지 않는다.

**선별 소스 8개** — 아래 링크는 모두 같은 commit으로 고정했다.

| 파일 | 확인한 구현 |
| --- | --- |
| [engine/src/lib.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/engine/src/lib.rs#L790) | `Session::execute` → dispatch, `edit`, `undo`, `redo` |
| [engine/src/commands.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/engine/src/commands.rs) | `CommandSpec`: id·JSON 인자 안내·enabled·run·journal; undo/redo 명령 등록 |
| [ops/src/lib.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/ops/src/lib.rs#L76) | `History::record/undo/redo/trim_with`, 상태 수·픽셀 바이트 예산 |
| [doc/src/lib.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/doc/src/lib.rs) | `Document`, `Layer`, 별도 `LayerMask`의 surface·enabled·density·feather |
| [raster/src/lib.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/raster/src/lib.rs#L243) | `Surface::tile_mut/try_tile_mut`: 공유 타일의 쓰기 시 복사 |
| [engine/src/layer_mask_props_cmds.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/engine/src/layer_mask_props_cmds.rs#L26) | `edit`: 문서·레이어 식별 검증, 마스크 속성만 변경 |
| [compose/src/masks.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/compose/src/masks.rs#L356) | `combined_mask/build_mask`: 픽셀·벡터 마스크와 feather의 유효 마스크 계산 |
| [io/src/lib.rs](https://github.com/storytold/photocraft/blob/3a896a5efca8c69ab7c00f0fd0160adfd76a6ae3/crates/io/src/lib.rs#L436) | `import_stages/export_stages`: `.pcraft` load/save 위임, 썸네일·합성 미리보기 분리 |

**작동 원리 3개.** ① 명령은 안정적인 id와 JSON 인자, 실행 가능 검사 및 실행 함수를 갖는다. `Session::execute`는 dispatch로 진입한다. README는 UI·CLI·MCP가 이 경로를 공유한다고 설명하지만, 각 프런트엔드 호출부 전부를 추적한 것은 아니다. ② `Session::edit`는 복제 문서에 편집 함수를 적용하고 성공 뒤 현재 문서를 교체한다. `History`는 `Arc<Document>`를 undo/redo 양쪽으로 옮기며 새 기록은 redo를 지운다. `Surface`는 `Arc<Tile>`을 공유하다 변경할 타일만 복사한다. 활성 background job이 있으면 `Session::undo/redo`는 false를 반환한다. ③ 마스크 픽셀과 density/feather가 별도 상태다. 속성 명령은 범위와 현재 문서 id를 검증하고 픽셀을 건드리지 않는다. 합성 단계가 속성을 반영한 유효 마스크를 계산한다. `.pcraft` 경로는 문서 저장과 미리보기를 구분하지만 내부 번들 직렬화까지 이번 범위에서 확인하지 않았다.

**Pankeki 적용 아이디어 2개 — 제안이며 효과는 미측정이다.**

1. **후보 조작을 화면·대화 공통 명령으로 정리.** PhotoCraft의 `CommandSpec`와 마스크 명령의 문서 id 검사처럼, 후보 보기·재편집·비교에 명령 id와 candidateId, 프로젝트/편집 세대 검사를 둔다. 현재 [app.js](D:/Pankeki/web/src/app.js:460)의 `generate/requestSnapshot` 및 `serial/editEpoch` 검사를 공통 경로에 연결하고 실제 생성은 기존 `/api/jobs`에 맡긴다. 대화 모델의 DOM 직접 조작을 줄이고 늦은 제안이 다른 후보에 적용되는 문제를 막는 데 도움이 될 것으로 예상한다. 생성 undo는 GPU 실행을 되돌린다는 뜻으로 쓰지 않는다.
2. **마스크까지 이어지는 편집 체크포인트.** `LayerMask`·COW 이력·문서 저장 분리에서 착안해 후보의 원본 이미지 참조, 마스크 스냅샷, 편집 속성, parentId, 요청 모델/설정을 함께 보관한다. 첫 범위는 최근 마스크 획 undo/redo와 저장 후 같은 영역 재편집으로 제한한다. 현재 [profiles.js의 createProject/parseProject](D:/Pankeki/web/src/profiles.js:270)는 request의 source/mask를 제외하고 version1 필드를 엄격히 검사하므로, 별도 버전/호환 정책·이미지 참조 재사용·기존 64MiB 상한을 먼저 설계해야 한다. 브러시 실수 복구와 편집 재개성이 좋아질 것으로 예상하지만 생성 품질 개선을 보장하지 않는다. PhotoCraft 타일 엔진 전체 도입은 후속 메모리 측정이 필요하다.

README의 COW·비파괴 편집 소개는 위 코드 구조와 부합한다. README가 밝힌 early alpha 및 생성형 기능의 공백을 고려하면 이미지 모델 품질 해결책으로 볼 수는 없다. 검증 범위는 공식 API/raw의 정적 소스 대조이며 clone·설치·빌드·테스트·GPU 실행은 하지 않았다.
