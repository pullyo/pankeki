# Qwen3.8-27B 로컬 실행 준비도 — 2026-10-19

**판정: Windows CPU+NVIDIA GPU 분산 4비트 실행 경로와 배포 파일은 확인됐다. 현재 장비에서의 적재 성공·속도·비전 품질은 미측정이다.** 대상은 사용자가 지정한 **Qwen3.8-27B dense 모델**이다. 공식 카드는 27B, 비전 인코더 포함, 이미지·영상 이해, Apache-2.0으로 명시한다. MoE 모델로 표기하지 않는다. 원본은 Transformers/Safetensors 형식이다. [Qwen 공식 모델 카드](https://huggingface.co/Qwen/Qwen3.8-27B)

**실행 지원:** llama.cpp는 4비트 양자화, NVIDIA CUDA, VRAM보다 큰 모델의 CPU+GPU 혼합 추론을 지원한다. Windows x64 빌드 경로도 공식 문서에 있다. `--n-gpu-layers`로 GPU에 둘 레이어 수를 제한하며, 현행 서버에는 dense FFN의 일부를 CPU에 두는 `--n-cpu-ffn`도 있다. Qwen3.8의 공식 config는 `qwen3_5` 아키텍처이고, llama.cpp의 qwen35 구현은 64레이어/27B를 처리한다. 이 아키텍처 이름은 다른 모델로 바꾼다는 뜻이 아니다. [llama.cpp 지원](https://github.com/ggml-org/llama.cpp#description), [Windows/CUDA 빌드](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md), [서버 옵션](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [공식 config](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/config.json), [qwen35 구현](https://github.com/ggml-org/llama.cpp/blob/master/src/models/qwen35.cpp)

**배포 크기:** llama.cpp 개발 조직인 **ggml-org의 변환본**이며 Qwen 명의 원본 저장소와 구분한다. 전체 저장소를 받을 필요 없이 필요한 GGUF만 선택하는 구조다. 아래는 원격 파일 목록의 십진 단위 반올림값이며 실행 RAM 요구량이 아니다. [ggml-org 원본 연결 카드](https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF), [실제 파일 목록](https://huggingface.co/ggml-org/Qwen3.8-27B-GGUF/tree/main)

| 파일 | 표시 크기 | 용도 |
|---|---:|---|
| Qwen3.8-27B-Q4_K_M.gguf | 약 19 GB ≈ 17.7 GiB | 혼합 4비트 계열 본체 |
| mmproj-Qwen3.8-27B-Q8_0.gguf | 약 629 MB | 비전 인코더/프로젝터 |
| mmproj-Qwen3.8-27B-BF16.gguf | 약 931 MB | 비전 대안, 둘 중 하나 |
| Qwen3.8-27B-BF16.gguf | 약 53.8 GB | 비교용 원본 정밀도, 이번 후보 아님 |

**비전 경로:** 해당 모델용 mmproj 배포가 존재한다. llama.cpp는 언어 GGUF와 대응 mmproj를 함께 사용하며 `--mmproj`를 지정할 수 있다. `--no-mmproj-offload`로 프로젝터를 CPU에서 실행하는 선택지도 있다. 이미지 전처리/이미지 토큰은 추가 메모리를 사용한다. 배포·실행 옵션 확인과 이 PC에서의 비전 성공은 구분한다. [공식 mmproj 설명](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md), [서버 비전 옵션](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

**이 PC의 제약과 다음 검증 조건:** 인계받은 RTX 5060 8GB, 시스템 RAM 31.71 GiB/최근 여유 8.91 GiB 기준, Q4 본체는 VRAM 전체 적재가 안 된다. 단순 용량 계산상 현재 여유 RAM에 VRAM 전체를 더해도 약 17.7 GiB 본체보다 작으며, KV/순환 상태·계산 버퍼·비전·OS 공간이 추가된다. 파일 mmap/페이지파일이 있더라도 충분한 상주 메모리나 실용 속도를 보장하지 않는다. 따라서 **Comfy 모델의 메모리를 해제한 뒤 Qwen을 실행하고, Qwen을 해제한 뒤 Comfy를 사용하는 교대 운용**만 검토한다. 이는 추론상 권고이며 이번 조사에서 어떤 프로세스도 중단하지 않았다. 추후 별도 실행 승인 시 여유 RAM 재확인, 짧은 2K–4K 문맥/단일 요청, 보수적 GPU 레이어 수, 텍스트 후 단일 이미지 순으로 적재량·페이지 사용·첫 응답 시간·생성 속도를 측정해야 한다. CUDA 배포 빌드와 현재 드라이버의 조합도 아직 검증하지 않았다.

Ollama 11434/LM Studio 1234는 총괄의 최근 확인상 미설치·미연결이다. 이번 작업은 공식 웹 문서/파일 메타데이터 조회와 이 인계문 작성만 수행했으며, 모델 다운로드·설치·코드 변경·GPU 실행·대체 모델 선택은 하지 않았다.
