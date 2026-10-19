# 외부 구성 요소와 이미지

Pankeki의 MIT 라이선스는 별도 조건이 있는 외부 소프트웨어·모델·브랜드 이미지에 대한 권리를 변경하지 않습니다.

| 항목 | 사용 방식 및 조건 |
| --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | 별도 설치 후 로컬 API 연결. ComfyUI 소스·모델은 포함하지 않음. upstream GPL-3.0 조건 확인 필요 |
| comfy-sdk 0.5.0 / comfy-api-proxy 0.1.6 | 선택 설치 의존성. MIT 원문은 integrations/comfy-sdk/licenses에 포함 |
| [SD Turbo](https://huggingface.co/stabilityai/sd-turbo) | 개발 예시 모델. 가중치 미포함. [모델 라이선스](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md)는 MIT가 아닌 Stability AI Community License |
| CropAndStitch / WaveSpeed | integrations/github/sources.lock.json에 참조 버전 기록. 외부 소스 미포함. 각 upstream 라이선스 적용. 설치 상태 기록은 당시 개발 환경의 기록이며 현재 설치를 보장하지 않음 |
| NumPy / Pillow / websocket-client | requirements에 명시된 별도 의존성. 각 배포물의 라이선스 적용 |

`web/assets/pankeki-selected-base.png`는 프로젝트를 위해 AI 이미지 생성으로 제작하고 사용자가 선택한 팬케이크 로고입니다. 생성 도구가 내부 모델 버전을 공개하지 않아 특정 모델 버전을 주장하지 않습니다. 해당 브랜드 자산의 상표권 검토나 모든 사용에 대한 권리 보장을 의미하지 않습니다.

`docs/images/studio-preview.png`는 실제 개발 화면이며 AI 생성 예시 이미지를 포함합니다. 모델 출력물의 이용 조건은 모델 제공자의 조건을 함께 확인해야 합니다. 공개 코드의 MIT 표기를 제3자 모델·출력물의 무조건적인 이용 허가로 해석하지 마세요.

폰트 파일과 다운로드한 Lucide/Pretendard 패키지는 이 스냅샷에 포함하지 않습니다. 웹 빌드는 시스템 글꼴과 소스에 포함된 기본 SVG 아이콘을 사용합니다.
