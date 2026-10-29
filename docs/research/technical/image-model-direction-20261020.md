# Pankeki 이미지 모델 선택 검토

2026년 10월 20일 · 아지 총괄 · 공식 자료에 근거한 비교 후보 선정. 새 모델 설치·실행·품질 비교는 아직 수행하지 않았다.

현재 구성의 SDXL은 비교 기준으로 유지하고, FLUX.2 Klein 4B의 경량 실행 경로를 첫 교체 후보로 검증한다. 모델 교체의 판정은 생성 이미지의 외관뿐 아니라 같은 원본의 색·소재·표정 수정, 얼굴 유지, 응답 시간과 실제 GPU 메모리 사용을 함께 따른다.

| 모델 | 검토 역할 | 확인된 조건과 남은 검증 |
| --- | --- | --- |
| 기존 SD Turbo·SDXL | 기능 회귀와 이미지 품질의 비교 기준 | 기존 저장 실험의 세부 지시 실패를 모델 일반 성능으로 확대하지 않는다. 복원 환경의 가중치·추론 준비가 필요하다 |
| FLUX.2 Klein 4B | 첫 교체 비교 후보 | 생성·이미지 편집·다중 참고 입력 지원. 공식 NVFP4 배포가 있다. ComfyUI 가이드 예시는 약 8.4GB이므로 8GB에서 적재 가능·사용 속도를 확정할 수 없다 |
| Qwen-Image-2.1 | 투명 부위 소재와 국소 편집의 후속 후보 | 7B 시각 생성 구성, RGBA 생성·투명 레이어 편집·마스크와 참고 입력을 공식 지원한다. CPU offload 안내가 있으나 8GB 적재·속도는 이 PC에서 미측정이다. 라이선스는 Qwen Research로 배포 조건 검토가 필요하다 |
| FLUX 3 Image Klein | 최신 기능 비교용 후속 후보 | 공식 reference 구현의 1024px 메모리는 prompt upsampler 제외 NVFP4도 25GB로 안내된다. 8GB 기본 모델 후보로 바로 채택하지 않는다. 양자화 파일 크기를 전체 메모리로 해석하지 않는다 |

첫 검증은 같은 원본에서 장갑 색 변경, 가방 소재 변경, 표정 변경을 수행한다. 원본·영역·시도 횟수를 통제하고, 요청 충족·얼굴과 스타일 유지·경계·지연·메모리를 기록한다. 작은 사전 비교를 통과한 후보만 시드와 원본 범위를 넓힌다. 현재 SDK/워크플로의 모델별 연결과 마스크 밖 합성은 별도 계약 검사 대상으로 유지한다.

색·위치·등록된 표정처럼 소재와 파라미터로 처리하는 조작은 새 생성 모델 호출과 분리한다. Codex는 대화·명령 해석 경로이고, 이미지 추론은 ComfyUI의 선택 모델이 담당한다.

근거: [ComfyUI FLUX.2 Klein 가이드](https://docs.comfy.org/tutorials/flux/flux-2-klein), [FLUX.2 Klein 4B NVFP4](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-nvfp4), [Qwen-Image-2.1 공식 모델 카드](https://huggingface.co/Qwen/Qwen-Image-2.1), [FLUX 3 Image Klein 공식 모델 카드](https://huggingface.co/black-forest-labs/flux-3-image-klein).
