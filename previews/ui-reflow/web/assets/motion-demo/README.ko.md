# 직접 제작한 팬케이크 파코 예제

모델이나 이미지 생성 호출 없이 Pankeki를 위해 직접 작성한 벡터 그림과 실제 RGBA PNG입니다. 정지 프레임을 바꿔 재생하는 영상이 아닙니다. `project.json`은 사용자 v2 파일과 같은 파서·editor·renderer·controller 경로로 가져옵니다.

| 소재 | 크기 | 수동 준비 |
|---|---|---|
| source.png | 640×640 RGBA | 아래 PNG의 기본값 실제 합성. 참조 원본이며 덧그림 배경이 아님 |
| background.png | 640×640 RGBA | 캐릭터·눈·입이 없는 깨끗한 아침 식탁과 접시 |
| body.png | 440×410 RGBA | 팬케이크 몸·버터·시럽·볼·손발. 눈과 입은 없음 |
| eyes.png | 160×44 RGBA | 눈 소재. 감김 key는 높이6.16px로 압축하며 면적0을 쓰지 않음 |
| mouth.png | 68×36 RGBA | 치아·입안·혀가 있는 소재. 기본 배율Y=8/36에서8px, 열린 key에서40px 높이 |

원본 SVG는 `background.svg`, `body.svg`, `eyes.svg`, `mouth.svg`, 조립한 제작 master는 `source-design.svg`입니다. PNG 바이트와 수동 준비 과정은 `provenance.json`에 있습니다. 그림 자산의 라이선스는 `LICENSE.txt`를 따릅니다. 기존 Pankeki 선택 로고와는 별도의 예제 캐릭터입니다.

기본 배치(문서640²): 몸은 루트(100,125), 눈은 몸의 자식(140,194), 입은 몸의 자식(186,244), 입의 Y배율은8/36입니다. 각 메시의 base는 소재 PNG의 실제 크기에 맞춘4×4정점·18삼각형입니다. 눈 뜨기 기본1·입/호흡 기본0의 delta는0이며 모든 파라미터는0..1입니다. 부드러운 호흡은 몸1.8% 가로·2.5% 세로 변위와 눈/입의 작은 이동을 함께 계산합니다. 이 좌표와 key는 수동 준비된 예제이며 자동 리깅 결과가 아닙니다.

재제작(새 설치/다운로드 없음): `node web/assets/motion-demo/render-assets.cjs`로 기존 Chrome Canvas에서 SVG를 RGBA PNG로 렌더하고, `node web/assets/motion-demo/make-project.cjs`로 실제 파일 해시와 공개 computeRigHash를 사용한 v2 파일을 만듭니다. 도구 경로는 이 작업 PC의 설치된 Playwright/Chrome을 사용합니다. 다른 PC에서는 설치 경로를 맞춰야 하며 이 스크립트가 패키지를 설치하지는 않습니다.

원본 PNG·UV·연결·asset bytes는 파라미터로 덮어쓰지 않습니다. 프로젝트를 다시 열 때 과거 undo 이력은 복원하지 않습니다. 실제 동작/48프레임 출력 완료는 이 파일이 존재하는 것만으로 판단하지 않고 T9에서 사용자 PNG와 함께 검증해야 합니다. 현재 실제 renderer의 공유 삼각형 경계 이음새는 디자인 인계의 재현 사항을 따릅니다.
