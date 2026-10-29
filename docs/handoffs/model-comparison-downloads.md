# 모델 비교 다운로드·실행 인계

2026-10-20 14:12:19.000 KST 총괄 최종 전송 확인. **7개 가중치 총27,827,319,993bytes의 다운로드와 공식 크기·SHA256 검증이 모두 완료**됐다. 마지막 Qwen 전송도 exit0이다. 완료 manifest는 `work/model-comparison-20261020/transfer/verified-manifest.json`이다. GPU 추론이나 품질 비교 완료를 뜻하지 않는다.

| 파일 | 현재 검증 상태 |
| --- | --- |
| SDXL Base 1.0 단일 체크포인트 | 6,938,078,334 bytes, SHA256 공식 메타데이터 일치, 전송 명령 exit0 |
| FLUX.2 Klein 4B NVFP4 | 2,460,413,488 bytes, SHA256 일치, 전송 명령 exit0 |
| FLUX FP4 텍스트 인코더 | 3,848,213,998 bytes, SHA256 일치, 지원 파일 전송 명령 exit0 |
| FLUX VAE | 336,211,292 bytes, SHA256 일치, 지원 파일 전송 명령 exit0 |
| Qwen-Image-2.1 Turbo INT8 DiT | 7,256,787,829 bytes, SHA256 일치. 같은 세션에서 남은 파일 다운로드 계속 |
| Qwen W4A8 텍스트 인코더 | 6,312,105,364 bytes, SHA256 일치, Qwen 전송 명령 exit0 |
| Qwen VAE | 675,509,688 bytes, SHA256 일치, Qwen 전송 명령 exit0 |

전송 세션·revision·검증 근거는 `work/model-comparison-20261020/transfer/download-sessions.json`, 공식 메타데이터는 `transfer/metadata/`를 따른다. Qwen13945를 포함한 모든 현재 전송이 종료돼 중복 전송하지 않는다. 초기 HF 중단 세션의 임시 파일은 최종 모델로 세지 않는다. 열려 있는 writer의 진행량은 공유읽기 FileStream.Length로 확인하며 directory-entry 길이0을 정체로 해석하지 않는다.

## 실행 준비

기술 담당의 [실행 환경 인계](model-comparison-runtime.md)를 그대로 수집했다. `D:/Pankeki/work/model-comparison-20261020/technical/`에 실험 harness·runtime probe/setup·오프라인 검증·가중치 레이아웃 기록을 원본 SHA256과 일치하도록 복사했다. 비교용 코드이며 제품 코드/기본 모델 변경이 아니다.

**14:15:50 KST의 `runtime/setup-status.json`은 installed_cpu_checked_gpu_unverified, `runtime/cpu-probe.json`은 cpu_imports_and_required_nodes_passed다.** 설치와 CPU import/필수노드 확인은 완료됐고 GPU 적재·커널·품질은 아직 미검증이다. 가중치7개도 완비됐다. QA 필수 보완 후 오프라인11개가 통과한 최종 harness SHA256은 `89889ee96b78298f070c70f7ecfce3516e23d09a010808fbd4d23b5eaaccc700`이며 수집본과 일치한다. 모델별 `--check`와 배타 lock을 확인한 뒤 QA가 실제 실험을 시작하도록 총괄이 인계했다.

실행기: `D:/Pankeki/work/model-comparison-20261020/envs/comfy-cu130/Scripts/python.exe`

수집한 harness: `D:/Pankeki/work/model-comparison-20261020/technical/compare_harness.py`

준비 확인은 `--model sdxl-baseline --check`, `--model flux2-klein-4b --check`, `--model qwen-image-2-1 --check`다. 각 결과가 `ready_for_qa_gpu_trial`일 때 실제 GPU 실험 검토 대상으로 삼는다. 실제 GPU 제출은 `--run`을 명시할 때만 수행하며 각 모델의 T01부터 새 프로세스로 시작한다. 총괄이 허용한 범위는 공통 생성 T01과 독립 원본의 E01-gloves/E02-material/E03-expression이다. 첫 추론180초 초과/OOM/정리 실패 시 추가 실행 전에 원인을 보고한다. lock을 임의로 삭제하지 않는다.

인계의 외부 실제 원본 코드는 기술 담당의 허용 폴더 `C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/outputs/model-comparison/`에 있다. 수집본 이후 코드가 바뀌면 담당의 최종 hash와 다시 대조한 뒤 QA에 전달한다. 저장 입력/평가/aggregate/보드는 [QA 인계](model-comparison-results.md)를 따른다.
