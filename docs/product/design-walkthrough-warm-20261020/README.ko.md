# Pankeki 따뜻한 색감의 전체 화면 수정안

2026년 10월 20일. 사용자가 제공한 [색감 참고 이미지](reference-warm.png)의 크림·살구·꿀빛 주황·갈색을 기존 7개 화면 시안에 적용했다. 같은 제작 흐름과 화면 구성을 유지하는 시각 수정안이며, 실제 앱 코드에 적용하거나 새 기능을 구현한 결과는 아니다.

| 화면 | 수정 이미지 | 기능 상태 |
| --- | --- | --- |
| 프로젝트 홈 | [01-project-home.png](01-project-home.png) | 신규 화면 구성안 |
| 이미지 생성 | [02-image-generation.png](02-image-generation.png) | 생성 코드 구현. 모델·GPU 실행 환경 복원 필요 |
| 후보 비교 | [03-candidate-comparison.png](03-candidate-comparison.png) | 기존 기능 기반 화면 개편안 |
| 부분 수정 | [04-mask-inpainting.png](04-mask-inpainting.png) | 기존 수동 마스크 수정 기반. 추론 환경 복원 필요 |
| 부위 편집 | [05-reusable-parts.png](05-reusable-parts.png) | 개발 예정 |
| 표정과 동작 | [06-expression-motion.png](06-expression-motion.png) | 개발 예정 |
| 저장과 출력 | [07-project-export.png](07-project-export.png) | 기본 저장 구현. 부위·동작 저장과 확장 출력은 개발 예정 |

바탕은 크림, 패널은 따뜻한 흰색, 선택 영역은 살구, 주요 버튼과 조절 표시는 짙은 주황, 글씨와 아이콘은 갈색을 기준으로 삼았다. 캐릭터 그림과 색상환·마스크처럼 작업 내용을 나타내는 색은 따뜻한 UI색과 구분한다. 작은 팬케이크 로고를 유지했다.

색상 기준은 [theme-tokens.json](theme-tokens.json), 내장 이미지 생성 도구에 전달한 7개 수정 프롬프트는 [prompts.json](prompts.json)에 보존했다. 이미지 생성 결과의 색·문구·세부 배치는 구현 명세나 동작 검증을 대신하지 않는다. 기존 기능·미연결·개발 예정 상태는 위 표와 [기획안](../character-workflow-live2d-plan.ko.md)을 따른다.

참고 이미지의 유료 플랜, 가상 모델 이름, 자동 인식 등은 제품 기능으로 추가하지 않았다. [기존 밝은 회색·파랑 시안](../design-walkthrough-20261020/README.ko.md)은 별도로 보존했다. 수정 이미지 7장은 내장 image_gen 도구로 생성한 원본을 변경 없이 복사했고, 원본과 복사본의 SHA256을 대조했다.
