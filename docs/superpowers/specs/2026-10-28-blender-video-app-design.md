# Blender 구도 기반 로컬 영상 — 앱 통합 설계

사용자 지시: 기존에 선택한 Blender 앱에서 구도 편집 → Mac 로컬 AI 영상 생성 흐름을 완성하고 Pankeki 설치형 앱에 추가한다. 모델은 외장 SSD에 보존한다. 총괄은 직원에게 구현을 맡기고 결과를 검토·보고한다. 이 문서는 그 승인된 방향의 실행 범위를 기록하며 새로운 모델·클라우드·요금제 선택을 요구하지 않는다.

## 목표와 범위

- 기존 메뉴 ‘표정·동작’에서 ‘Blender 영상 만들기’로 진입한다. 기존 이미지·리깅·Live2D 작업과 로고/사이드바를 유지한다.
- 실제 .blend 파일을 네이티브 선택창으로 가져와 원본을 복사하고, 카메라 RGB/깊이 가이드를 만든 뒤 설치된 LTX 모델로 실제 영상을 생성한다.
- 실제 작업 상태·취소·오류·완료 파일 재생과 네이티브 저장창을 연결한다. 임의 가짜 진행률/결과를 만들지 않는다.
- 검증된 첫 설정은 384×256, 49프레임, 24fps, single-stage 8step, low-ram이다. 약2초 ‘빠른 미리보기’로 명시한다. 이 설정의 동작 완료가 고해상도 제작 품질의 승인을 뜻하지 않는다.
- 별도 영상 작업 상태를 사용해 이미지 프로젝트/마스크/후보 스키마를 바꾸지 않는다. 앱 재시작 시 미완료 영상은 orphaned로 남기고 자동으로 GPU에 다시 보내지 않는다.

## 접근 선택

1. 클라우드 영상 API: 사용자가 로컬을 선택했으므로 적용하지 않는다.
2. Comfy에 새 대형 영상 모델 연결: 이미 설치·실제 실행된 MLX 경로와 중복되므로 이번 범위에서 채택하지 않는다.
3. 기존 외장 SSD LTX MLX 실행기 연결: 사용자 선택을 따르며 기존 실제 49프레임 시험을 재사용할 수 있어 채택한다. 앱 연결은 새 작업으로 별도 검증한다.

## 공통 계약

네이티브 `pickVideoScene()`은 `.blend` 일반 파일(max128MiB, 심볼릭 링크 거절)을 사용자가 선택한 경우에만 `runtime/video/scene-grants/<UUID>.json`을 0600/원자쓰기로 생성한다. 필드는 version=1, scene_path, name, size, mtime_ns, sha256, created_at이다. 렌더러에는 `{scene_id,name}`만 반환하고 취소는 null이다. 백엔드는 고정 디렉토리의 유효 토큰과 24시간 만료·stat/SHA를 검증한다. 렌더 직전 복사한 scene snapshot의 SHA도 원본 grant와 같아야 한다. 공개 HTTP에 raw 경로 등록 라우트를 만들지 않는다. 기존 가이드 실행기의 autoexec 비활성 및 packed-only 외부자산 검사를 유지한다.

- `GET /api/video/status`: ready, reason, model {id,label}, defaults {width:384,height:256,frames:49,fps:24,steps:8}, blender_available.
- `POST /api/video/jobs`: {scene_id,project_id,epoch,prompt,seed:42} → {id,status}.
- `GET /api/video/jobs/<id>`: id,status,phase,progress(null 또는 관측값),guide_url,result_url,error,elapsed_seconds,width,height,frames,fps,project_id,epoch.
- `POST /api/video/jobs/<id>/cancel`: {}. 자기 child만 취소하며 global interrupt를 사용하지 않는다.
- `GET /api/video/results/<id>`: 완료 마커·파일 무결성 검증 후 ai_generated=true,url과 메타데이터. 가이드는 이 결과가 될 수 없다.
- `GET /api/video/assets/<id>/guide.mp4`, `result.mp4`: same-origin, byte Range 지원, 실제 파일만 전달.

영상 엔진 worker는 가이드 CPU 단계 뒤 실제 LTX subprocess에만 공용 GPU gate를 잡는다. 서버의 이미지 GPU 실행도 같은 gate를 사용한다. 외부 Comfy 작업이 실행 중이면 충돌을 피한다. 취소·서버 종료는 자기 child 수명만 관리한다. 실행물은 `runtime/video/` 새 작업 디렉토리로 격리한다.

## 화면과 보존

한 작업 공간에서 가져오기 → 구도 준비 → 생성 진행 → 완료 영상으로 전환한다. 구도 가이드는 ‘구도 가이드’로 표시한다. 긴 모델 설정 폼과 새 전역 메뉴를 만들지 않는다. 결과가 현재 project_id/epoch에 맞는 경우만 화면에 반영한다. 별도 영상 저장 키로 job_id를 보관하며 실패·취소에도 입력을 유지한다. 기존 한글 IME 처리를 유지한다.

## 완료 기준

소스/통제 테스트, Blender 실제 가이드, LTX 실제 추론, 네이티브 앱 재생·저장, 품질 판단을 구분한다. 새 앱에서 실제 .blend 선택→작업 제출→상태 표시→최종 MP4 재생→파일 저장을 확인한다. 저장 파일의 실제 디코드/프레임수/길이/코덱/SHA를 확인하고 기존 이미지 후보·저장자료를 보존한다. 현재 사용자 작업이 안전하게 보존되지 않으면 재시작 전에 그 상태부터 해결한다. 새 다운로드와 기존 Comfy 재시작은 범위 밖이다.
