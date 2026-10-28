# 모델 비교 준비 상태와 결과 기록

2026-10-20 KST 14:57 기준, 승인된 **3모델×4사례=12건의 실제 추론을 모두 완료했다. 실행 실패·OOM·커널 오류·cleanup 실패·자동 재시도는0건이고 최종GPU lock은 없다.** 편집9건의 final mask밖 RGB/alpha와 전체alpha 최대오차는 모두0이다. 이는 공통합성 보장이며 의미 품질 통과와 구분한다. 아래 준비·정적 검토 기록은 당시 상태이며 최신 실제 결과는 마지막 절과 `qa/results.json`, `qa/results.csv`, `qa/screening-summary.md`를 따른다. 최종 권장 모델은 아지가 PNG·비교판을 검토한 뒤 결정한다.

## 확정한 입력과 작은 선별 계획

공통 원본은 과거 로컬 SDXL 생성 사례 `B-sdxl-compact-601020`과 동일한1024×1024 캐릭터다. 기존 원본 PNG를 바이트 그대로 복사했으며 SHA256은 `ebb2166b1f8ee2eb9b24368e7c40a0e144a426ff54225cb26c3da10e6999a948`이다. 민감한 사용자 업로드는 사용하지 않았다.

모델별 공통 text2img1건과 같은 원본의 장갑 색·가방 소재·표정 편집3건을 준비했다. 편집은 이어 붙이지 않고 항상 같은 원본에서 시작한다. 가방 mask는 이전101×71 영역 그대로이며 장갑 두 곳·얼굴에는 수동 폴리곤 mask를 만들었다. mask 세부 범위를 이미지로 확인했다. 불투명 RGB 원본과 별도로 비불투명 알파·숨은 RGB 보존을 검증하는32×24 합성 fixture를 준비했다.

첫 선별은 지원 작업에 한해 모델당 최대4건이다. 실제 첫 추론이180초를 넘거나 예상 총시간이 예산을 넘으면 T01 뒤 우선 E01만 제안하며 추가 편집은 정확한 실행 지시를 기다린다. OOM은 별도 상태로 중단하고 재시도·양자화/해상도 fallback을 자동으로 하지 않는다. 선별 후 한 후보의 필요한 사례에만 추가 seed2개를 고려한다.

비교 단위는 **모델 revision·가중치 hash·양자화·dtype/offload·해상도·steps·guidance·sampler/scheduler·편집강도·runtime/harness**다. 같은 seed 숫자는 모델 간 같은 noise를 뜻하지 않는다. 생성과 편집은 별도 분모로 비교하며 미지원 편집은 N/A다.

SDXL의 보존된 프로젝트 기준선은1024²/25steps/CFG6/dpmpp_2m/karras/편집강도0.55, UNet/text FP16·VAE FP32다. FLUX.2 Klein 4B와 Qwen-Image-2.1의 공식 가용성·기능·native 권장값·양자화는 기술 담당 인계 전이므로 null로 두었다. 이번 QA는 해당 모델에 대한 추천 설정이나8GB 실행 가능성을 추측하지 않았다.

## 판정과 기록

편집의 지시 충족·얼굴 정체성·그림체·경계·새 결함을 수동0~3으로 기록한다. 지시/정체성/그림체/경계가 모두2이상이고 심각한 새 결함이 없을 때 사용 가능 후보로 둔다. 기계적 지표는 모델 raw와 공통 mask 합성 후 final을 분리하며 final의 마스크 밖 RGB/alpha 최대오차0, 전체 원래 alpha 유지, 좌표/크기 일치를 확인한다. 합성으로 만든 보존을 모델 고유 성능으로 해석하지 않는다.

first-load·추론·total벽시계와 실제 warm 호출 여부를 나누고, 계측한 PyTorch peak allocated/reserved만 해당 필드에 기록한다. nvidia-smi 표본은 별도 장치 메모리 지표다. 기존9개 결과에는 재실험 측정값을 붙이지 않았다.

현재 결과 상태:

| 후보 | 공통 생성 | 공통 편집3개 | 신규 시간/VRAM/품질 |
| --- | --- | --- | --- |
| SDXL 기준선 | 실행 인계 대기 | 실행 인계 대기 | 미측정 |
| FLUX.2 Klein 4B | 기능·가중치·runtime 인계 대기 | 기능·runtime 인계 대기 | 미측정 |
| Qwen-Image-2.1 | 공식 가용성·가중치·runtime 인계 대기 | 기능·runtime 인계 대기 | 미측정 |

`results.json`·`results.csv`의12행은 세 후보×네 계획 사례의 대기 행이다. 출력 경로·성능·점수·승자는 비워뒀으며 가짜 결과나 실패 판정이 아니다. 모델별 실제 출력 디렉터리만 준비했다.

## 산출물과 검증

모든 QA 산출물은 `D:/Pankeki/work/model-comparison-20261020/qa/`에 있다.

- `evaluation-plan.ko.md`, `evaluation-plan.json`: 고정 prompt·case·판정·예산·단계·필수 실행 메타데이터
- `input-manifest.json`, `inputs/`: 원본/마스크/합성control7개와 원본 파일·RGBA픽셀 hash, 수동 mask 좌표
- `historical-input-audit.json`, `boards/historical-nine-reference.png`: 기존9개 PNG hash 일치와 과거 비교판. 현재 생성 결과와 구분
- `boards/input-mask-overview.png`, `boards/mask-detail-review.png`: 동일 원본의 색·소재·표정 입력과 mask 확대판
- `results.json`, `results.csv`, `outputs/<model_id>/`: 실제 인계 후 결과를 저장할 계약과 대기 행
- `gpu-handoff.md`, `preparation-status.json`: GPU 미점유 상태, 배타 lock·PID 검증·인계 조건 및 현재 의존성
- `prepare_inputs.py`, `finalize_plan.py`: 다운로드/네트워크/모델 추론 없는 로컬 데이터 준비·일관성 검증

실행 명령:

```powershell
& D:/Pankeki/.venv/Scripts/python.exe -B -X utf8 D:/Pankeki/work/model-comparison-20261020/qa/prepare_inputs.py
& D:/Pankeki/.venv/Scripts/python.exe -B -X utf8 D:/Pankeki/work/model-comparison-20261020/qa/finalize_plan.py
```

검증 결과는 입력7개 hash/크기/mask값 확인, 기존9개 PNG hash 일치, 원본/기존 mask 불변, 합성 fixture의 mask밖 RGBA 및 전체alpha 최대오차0이다. 생성 제출0회다. `preparation-validation.log`와 `preparation-status.json`에 기록했다.

## 아지에게 필요한 인계

입력과 평가 기준은 준비됐다. 실행의 의존성은 기술 담당의 **공식 revision/hash·기능 지원표·native preset·양자화/dtype/offload·실행기/harness hash와 명령·예상 시간**, 기술 담당의 GPU 반환, 아지의 정확한 실행 지시다. 지금 QA는 GPU lock을 획득하지 않았다. 기술 담당과 동일 GPU를 동시에 사용하지 않도록 실제 PID·종료/큐 상태와 배타 lock을 확인한 뒤 순차 실행한다.

생산 코드·앱 기본모델·`runtime/config.json`·기존 실험 증거·백업은 수정하지 않았다. 새 채팅/하위 에이전트나 중복 다운로드/환경 설치도 수행하지 않았다. 다음 단계는 준비된 harness를 읽고 capability/preset을 계획에 대조한 뒤 아지가 지정한 소수 사례를 실행하는 것이다.

## 14시08분 추론 전 harness 계약 검토

새 다운로드·runtime 인계와 `technical/compare_harness.py`를 기존 계획에 정적으로 대조했다. 수집본 SHA256은 배정된 `6863c895f0ef26de1cbfaf6bdcea27f4b4a67d48f4568ec86a4bce98d884c679`와 일치했다. 기존 계획·입력·harness·생산 코드는 수정하지 않았다. `technical/offline-verification.json`의7개 통과는 이전 오프라인 증거로 읽었으며 재실행하지 않았다.

모델/사례 ID, 같은 원본의 독립 편집, 원본·mask hash 확인,1024² 크기 거부, SDXL25/CFG6/dpmpp_2m/karras/.55, raw/final 분리와 mask 밖 보존, 단일 사례 순차 실행, 배타 lock과 정리 실패 시 lock 유지가 계획과 대응한다. 새 기술 인계의 FLUX4steps/CFG1/Euler/Flux2Scheduler·NVFP4/FP4 및 Qwen8steps/CFG1/Euler/명시적Turbo sigma·INT8/W4A8도 확인했다. 이는 서로 다른 모델+양자화+권장 실행 조건이며 실제 적재 성공은 아직 아니다.

실행 전후 반드시 구분할 차이는 다음과 같다. 전체 정적 기록과 줄 번호는 `qa/harness-contract-review.json`에 있다.

| 차이 | 판정 및 후속 처리 |
| --- | --- |
| 시간 정의 | 기존 계획의 `inference_s`는 warm 호출이지만 harness는 새 프로세스의 conditioning+sampler+decode와 lazy load/offload를 포함한다(152,234–280행). 기술 인계처럼 **cold 첫 호출 지연**으로 표시하고 warm은null을 유지한다. |
| 벽시계 경계 | `total_wall_s`는 계약 로딩/출력 폴더 생성 뒤 시작하고 최종 metrics 저장/프로세스 종료 전에 끝난다(144–148,309–310행). 계획의 프로세스 시작~저장 전체와 다르므로 추후 허용된 실행 시 외부 subprocess 벽시계를 따로 기록하거나 해당 필드를 harness 내부 구간으로 표기한다. |
| 보존 지표/CSV | harness는 mask밖 RGB/alpha를 합친 `*_outside_rgba_max_error`와 전체alpha를 출력한다(290–298행). QA CSV의 RGB/alpha 개별 필드는 원본·mask·raw·final로 오프라인 재계산하고 VRAM peak 필드명도 명시적으로 대응한다. combined0은 둘 다0을 뜻하지만 nonzero만으로 RGB/alpha 성분을 나눌 수 없다. |
| OOM 계측 | peak allocated/reserved와 inference시간은 pipeline 성공 뒤에만 저장된다(280–285행). 예외 경로에는 실패 단계·allocator peak가 명시적으로 남지 않는다. 기술 담당의 실패 경로 계측 보완이 필요하며 미보완 시 해당 값은 미측정으로 기록한다. OOM을0메모리로 표시하거나 자동 재시도하지 않는다. |
| 준비 검사/오류 분류 | `--check`는 상태파일을 확인하지만 `--run` 내부는 이를 호출하지 않는다. 누락 runtime/input도 `unavailable_weights`, 그 밖의 많은 오류도 `unsupported_runtime`으로 합쳐진다(124–140,143–180,302–304행). 별도ready검사·총괄 지시를 외부 필수조건으로 지키고 실제 모델 미지원·입력/출력 실패·예산 보류를 QA에서 구분한다. |
| 실제 출력 위치 | 준비한 `qa/outputs/` 대신 `qa/runs/<model>/<case>/<고유실행>/`에 쓴다(146행). 향후 집계는 이 실제 경로를 참조하며 과거 run을 덮어쓰지 않는다. |

14:08:18 KST 확인에서 `runtime/setup-status.json`, `runtime/cpu-probe.json`은 모두 없었고 `gpu.lock`도 없었다. 따라서 **이번 검토에서는 `--check`와 `--run`을 모두 실행하지 않았다.** SDXL·FLUX의 가중치 검증 완료는 다운로드 인계 기록이며 QA가 수GB 파일을 다시 해싱하지 않았다. Qwen encoder/VAE는 같은 인계상 전송 중이다. 준비 상태 파일·모델별ready검사와 실제 GPU 인계를 받은 뒤에도 아지의 정확한 실행 지시를 기다린다. 신규 추론0회, 새 성능/품질 결과 없음이다.

## 14시24분 승인된 실제 비교 시작

아지가 runtime/CPU probe·7개 가중치 완료와 수정 harness를 인계하고 SDXL→FLUX→Qwen 순서의 실제 실행을 지시했다. 최신 harness SHA256 `89889ee96b78298f070c70f7ecfce3516e23d09a010808fbd4d23b5eaaccc700`을 확인했다. 수정본은 runtime 준비 gate와 실패 단계/예외별 상태·가능한 OOM 계측을 추가했고 오프라인11개 통과 기록이 있다. 이 오프라인 검사는 QA가 반복하지 않았다.

SDXL의 별도 `--check`가 `ready_for_qa_gpu_trial`로 통과한 뒤 시작했다. GPU 프로세스 이름을 읽기 전용으로 확인했으며 Python은 해당 CPU check 프로세스뿐이고 기존 화면/브라우저 점유 외 모델 추론 작업은 보이지 않았다. 시작 시GPU lock은 없었다. 새 실행기나 모델·정밀도/steps 변경은 하지 않았다.

각 사례는 QA의 `run_one_case.py`가 승인된 harness를 새 subprocess로 한 번만 호출한다. harness lock은 그대로 사용하고 QA wrapper는 프로세스 시작~종료 벽시계와 실행 전후 장치 메모리 표본만 더 기록한다. `qa/executions/`에 outer로그/명령/시각을 보존한다. 실제 입력·모델·원출력·최종출력·harness metrics는 `qa/runs/` 원본을 참조한다.

현재 SDXL의 T01과 E01은 성공·cleanup 완료이며 각 뒤 GPU lock이 없음을 확인했다. T01은 cold파이프라인69.60초/외부 프로세스94.00초, E01은60.63초/114.92초로180초 기준 이내다. T01은 단일전신 구도지만 갈색 장갑·잘못된 황동 소품 관계로 엄격 지시를 통과하지 못했다. E01도 청록색 대신 갈색/회색 장갑이며 왼쪽 경계에 눈에 띄는 회색 부분이 있다. E01의 final mask밖 RGB/alpha 및 전체alpha 오차0은 공통합성 보장으로 별도 기록한다. 추가 사례는 승인 순서대로 진행 중이다.

`aggregate_results.py`는 실제 완료된 outer/metrics와 PNG만 읽어 `results.json`·`results.csv`, 사례별 `boards/*-comparison.png`를 갱신한다. 실패/미실행은 빈 출력과 실제 상태로 표시하고 수동 점수는 `visual-scores.json`의 직접 이미지 검토만 반영한다. Torch allocated/reserved peak는 해당 allocator 계측이며 DynamicVRAM의 모든 외부 할당을 포함한 전체 장치 peak라고 주장하지 않는다. warm latency는null이다.

## 14시57분 실제 선별 완료와 아지 검토 인계

SDXL→FLUX→Qwen, 각 모델 T01→E01→E02→E03 순서로 새 프로세스를 사용해12건 모두 성공했다. 외부 프로세스 시작/종료 기록의 겹침0, 재시도0, 매 작업 뒤 lock 해제를 확인했다. 마지막Qwen 표정 사례도 cold파이프라인145.76초/전체프로세스216.80초로 성공했다. 모든 `inference_s`가180초 이내였고, 최대값은Qwen 소재179.66초다. 전체 wall시간이180초보다 긴 사례는 있으나 판정 기준인 cold pipeline과 혼동하지 않았다.

아래는 **각 사례1seed**의 수동 사용 가능 기준이다. 편집은 지시·얼굴·그림체·경계가 각각2점 이상이고 큰 새 결함이 없으며 final외부 보존을 충족해야 통과했다. 통과가 완벽한 동일인물·재질·모든 지시를 보장하지 않는다. 특히Qwen 표정의2점 판정은 경계선상의 육안 의견이므로 아지의 원본 확대 검토가 필요하다. 과거9개 전체 요구0/9와 표본·판정 단위를 섞지 않는다.

| 실제 profile | T01 생성 | E01 장갑색 | E02 가방소재 | E03 표정·정체성 | cold pipeline 범위 / process wall 범위 |
| --- | --- | --- | --- | --- | --- |
| SDXL unquantized,25steps/CFG6/dpmpp_2m/karras | 실패: 갈색 장갑·소품 관계 | 실패: 갈색/회색 | 실패: 광택 있는 빨간 직사각형 | 실패: 눈·눈썹과 그림체 변화 | 44.08–69.60초 / 88.58–114.92초 |
| FLUX.2 Klein4B NVFP4+FP4 encoder,4steps/CFG1/Euler | 사용 가능 | 사용 가능, 손끝/커프 경계 주의 | 개선됐으나 실패: 덮개 잘림·버클 미충족 | 실패: 과장된 만화풍 얼굴 | 34.11–40.46초 / 50.69–77.66초 |
| Qwen-Image2.1 Turbo INT8+W4A8 encoder,8steps/CFG1/Euler/고정sigma | 사용 가능, 곱슬머리 세부 차이 | 사용 가능, 작은 경계 전이 | 사용 가능, 가죽/봉제선/황동버클. 윤기·상단 윤곽 주의 | 사용 가능2점, 피부·눈썹·눈/볼 변화 잔여 | 133.15–179.66초 / 161.67–254.43초 |

시간 범위는 서로 다른 네 작업의 실제 관측값이며 반복 속도 벤치마크가 아니다. 현재 조건에서는FLUX가 짧은 지연으로 생성·색상 작업을 수행했고, Qwen은 소재와 절제된 표정에서 후속 검토할 결과를 냈으나 오래 걸렸다. 추가seed는 실행하지 않았다. 다음 확대 모델/사례 선택은 아지에게 남긴다.

기계적 결과는 편집9건 모두 final외부RGB0·외부alpha0·전체alpha0이다. native raw는 바깥이 바뀌었고 Qwen 소재 raw에서는 외부RGB177·alpha4의 최대오차를 측정했다. 따라서 제품의 엄격한 원본 보존에는 공통합성이 필요하며 모델의 고유 native 보존으로 보고하지 않는다. 현재 원본은RGB/불투명이고 비불투명alpha는 준비 단계 합성control로 별도 확인했다.

각 사례의 PyTorch peak allocated/reserved 및 pipeline중processRSS는 CSV/JSON에 저장했다. Torch계측 범위는SDXL354–355/630MiB, FLUX566.7–982.9/828–1704MiB, Qwen474.1–632.8/584–1036MiB다. **DynamicVRAM·custom 할당을 포함한 전체 장치 peak는 미측정**이며 이 숫자를 모델 전체VRAM 요구량으로 해석하지 않는다.8GB GPU+CPU VAE/offload의 해당 설정에서 끝까지 실행됐다는 범위만 확인했다. first_load, cold conditioning/sampler/decode, harness내부 wall, 외부 process wall을 분리했으며 warm은모두null이다. 예를 들어Qwen T01의CPU decode는88.35초였다.

최종 결과 위치:

- `D:/Pankeki/work/model-comparison-20261020/qa/results.json`, `results.csv`, `screening-summary.md`: 실제12건의 명령·모델 revision/quantization·수치·상태·수동 판정
- `qa/runs/<model>/<case>/<unique-run>/`: 변경하지 않은 request·attestation·raw/final PNG·metrics·stdout/stderr 원본
- `qa/executions/`: QA 외부 프로세스 벽시계·실제명령·시각·전후GPU 표본·종료코드
- `qa/boards/T01-character-comparison.png`, `E01-gloves-comparison.png`, `E02-material-comparison.png`, `E03-expression-comparison.png`: 원본/모델별raw와final 나란히 보기
- `qa/boards/E01-gloves-detail.png`, `E02-material-detail.png`, `E03-expression-detail.png`: 같은 좌표·배율의 목표 부위 확대
- `qa/visual-scores.json`: 직접 육안 관찰·0~3점·잔여 결함. 자동 의미품질 판정이 아님
- `qa/final-review.json`: 입력7개 hash 불변,12회 중복/겹침0,실패/지연 gate0,lock미존재의 최종 증거 대조

검증 명령은 `.venv/Scripts/python.exe -B -X utf8 work/model-comparison-20261020/qa/aggregate_results.py` 및 `finalize_screen.py`이며 둘 다exit0이었다. 최초 실행과 모델별check, 실제각case명령은 `qa/checks/`와 각 `outer.json`에 전체 인수로 보존했다.

실제 추가/갱신은 QA소유의 실행·집계·검증 도구(`run_one_case.py`, `aggregate_results.py`, `finalize_screen.py`), `checks/`, `executions/`, `runs/`, CSV/JSON·수동 검토·보드와 이 인계뿐이다. 기존 입력/평가계획·harness·제품코드·기본모델·과거실험·백업은 변경하지 않았다. harness 최종SHA는승인값89889ee…cc700과 같고 `runtime/config.json` SHA256도기존 `4298eaa063e73c7e090ae94fd9a101832240dfb6b45ced5a59d909a19bae0fdf` 그대로다. 생성된 모델 결과를 앱 기본값으로 채택하지 않았다.

이 선별은 SDXL에서 생성된 캐릭터1개, 각사례1seed, 작은고정mask, 서로다른모델+양자화+native설정의 탐색이다. 정체성·스타일과 손끝/가방 경계의 잔여 문제를 해결한 것으로 보고하지 않는다. 아지는 확대보드와 원본PNG를 보고 후보를 정한 뒤 필요한 사례에만 추가seed 또는 별도성능/편집profile 검증을 배정하면 된다.

## 총괄 검토 후 모델 실험 종료

아지가12건 JSON/CSV와 비교판·raw/final 확대를 직접 검토했고, 최종 판단은 [모델 비교 결론](../research/technical/model-comparison-conclusion-20261020.ko.md)에 기록했다. 이후 지시에 따라 이 모델 실험은 추가 추론·seed·재검증 없이 종료한다. 위의 후속 확대 제안은 미실행이며 현 작업의 다음 실행 지시가 아니다.

15:01 KST 마지막 파일 일관성 읽기 점검에서 JSON/CSV 각12행·기존 final review 성공12·참조PNG 누락0·GPU lock없음을 확인했다. 모델/PNG 디코드/보존수치/성능 검증을 다시 실행하지 않았다. 결과는 `qa/closure-consistency.json`에 남겼고 기존 원본·결과 수치는 변경하지 않았다. 다음 배정은 별도 움직임T9의 수용 목록 준비이며, 소스·빌드 인계 전 실제 테스트를 시작하지 않는다.
