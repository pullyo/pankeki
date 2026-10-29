# Pankeki 기존 로고 기록 — 사용자 거절, 최종 사용 중단

**상태 변경:** 사용자가 품질과 도라야끼처럼 보이는 형태를 거절했습니다. 아래 경로는 모두 보존용입니다. `final`이라는 옛 파일명도 승인된 최종안을 뜻하지 않습니다. 새 후보는 `logo-options.md`에서 관리합니다.

- 생성도구: 기본 내장 image_gen.imagegen, imagegen 스킬 기본 모드.
- 원본 PNG: `D:\Pankeki\web\assets\pankeki-logo-original.png`
- 프롬프트와 출처 기록: `D:\Pankeki\web\assets\logo-provenance.md`
- 팬케이크 두 겹과 창작의 반짝임을 결합한 심볼. 실제 생성 PNG 원본을 복사해 보존했으며 코드로 대체하지 않았습니다.
- 배경: 투명 알파 요청. 헤더에는 원본 PNG를 data URI로 내장하고 Pankeki 텍스트를 별도로 표시할 예정입니다.
- 원본 도구 저장본도 유지됩니다.
- 가장자리 정리: image_gen 편집을 두 차례 수행. 최종 적용본 `D:\Pankeki\web\assets\pankeki-logo-final.png`, 1차 편집본 `D:\Pankeki\web\assets\pankeki-logo-refined-v2.png`. 모든 프롬프트는 출처 기록에 추가했습니다.
- 원본과 편집본의 RGBA 알파 최솟값 0, 최댓값 255 확인. 실제 32px/48px 및 밝고 어두운 배경 비교는 브라우저 검증 진행 중.
