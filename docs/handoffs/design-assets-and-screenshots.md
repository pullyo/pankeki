# UI 자산과 공개용 화면 출처

- 현재 로고: `web/assets/pankeki-selected-base.png`. 사용자가 선택한 팬케이크 PNG 원본을 변경 없이 복사해 사용했습니다. 내장 `image_gen.imagegen` 생성 자산이며 정확한 모델 버전은 반환되지 않았습니다. 외부 스톡 이미지·아이콘을 로고로 사용하지 않았습니다. 원본·생성 경위는 `web/assets/active-logo-status.md`에 보존합니다. 별도 시럽 수정안은 승인 전이며 앱에 사용하지 않습니다.
- UI 아이콘: `web/build.py`의 프로젝트 내 FALLBACK SVG 경로로 렌더링합니다. Lucide 패키지·파일·라이선스를 다운로드하거나 내장하지 않았으므로 Lucide 사용으로 표기하지 않습니다. UI 코드의 배포 라이선스는 총괄이 준비하는 공개 저장소의 코드 라이선스에서 정해야 합니다. 현재 저장소 루트에는 LICENSE 파일이 없습니다.
- 글꼴: 시스템 Segoe UI / Malgun Gothic / sans-serif fallback. Pretendard 파일은 없고 빌드에서 @font-face를 제거합니다. 폰트 파일을 복사하거나 배포하지 않습니다.
- 후보 화면 이미지: 기존 실제 SD Turbo 검증의 프로젝트 `work/character-studio/visual-check/verified-project-with-edit.json`을 독립 브라우저에 불러온 것입니다. 허구의 ‘사막의 연금술사’ 테스트 캐릭터이며 실제 사용자 개인 프로젝트는 읽거나 덮어쓰지 않았습니다. 모델 출처·보존 라이선스는 `docs/licenses.ko.md`, `models/sd-turbo-LICENSE.md`를 따릅니다.
- 화면은 실제 `http://127.0.0.1:8190/`의 Chrome 캡처입니다. 생성형 UI 목업이 아닙니다. 이름·메일주소·토큰·키·로컬 파일 경로 등 개인 정보가 화면에 없는지 직접 확인했습니다. 앱 UI에 존재하는 작업명은 테스트용입니다.
- 개선 전: `docs/handoffs/web-design-user-rejected-20261019.png` (사용자가 제시한 실제 화면).
- 개선 후: `work/character-studio/design-revision/`의 1440x900 / 1920x1080 / 390x844 빈 화면·후보·비교 및 모바일 대화 화면 PNG. 총괄의 최종 시각 검수 후 공개 저장소 문서용으로 선택할 수 있습니다.

코드·모델·자산의 라이선스 범위를 하나로 합쳐 허용 범위를 단정하지 않습니다. 이 문서는 실제 포함된 디자인 자산의 출처 기록입니다.
