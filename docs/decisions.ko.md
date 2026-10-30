# 구현 결정과 검증 경계

2026-10-19, Asia/Seoul.

## 확정된 제품 방향

사용자가 부모 채팅에서 구현을 요청한 현재 방향은 **여러 분야의 오리지널 캐릭터 콘셉트 디자인 작업실**이다. 자유 창작·웹툰/웹소설·버튜버·마스코트·게임을 용도별 브리프와 예시로 지원한다. 게임 전용 앱으로 한정하지 않는다. 제품 사진 스튜디오는 과거 미채택 검토 후보이며 현재 결정이 아니다.

첫 구현 범위는 동일 원본의 후보 비교, 마스크 밖 원본 보존 편집, 선택 이력, 캐릭터 보드와 프로젝트 저장이다. 범위 확정과 기능 완료를 구분하며, 새 UI는 부모 채팅이 `D:\Pankeki\web\`에서 구현 중이다. 이번 개발 채팅의 변경은 공통 문서 반영에 한정한다.

새 포즈·여러 시점 일관성, 3D, 리깅, 최종 제작 에셋 자동 완성은 현재 약속 범위가 아니다. 기존 엔진과 실험을 보존하되 기존 일반 이미지 실험을 캐릭터 품질 검증으로 소개하지 않는다. 실제 캐릭터 입력에서 얼굴·손·부분 수정 경계 등의 품질을 별도로 확인한다.

공식 Comfy SDK 연동과 출품 요건 충족은 별도 미검증 항목이다. 대회 사실과 공통 맥락은 [contest-context.ko.md](contest-context.ko.md)를 따른다.

## 엔진과 최적화 결정

| 후보 | 현재 결정 | 이유와 fallback |
|---|---|---|
| 관측 + ComfyUI 기본 캐시 | 채택 | 기본 RAM 캐시 유지. 앱 완료 cache와 node hit를 따로 기록 |
| 정확한 완료 cache | 채택 | 알려진 builtin graph/내용 hash만 허용. 미확인 의존성은 bypass. 원자 SQLite 완료 기록, LRU, 손상 row 폐기 |
| preview throttle + revision | 채택 | 최대 5Hz 앱 수신 반영, stale 결과 무시. Comfy 자체 preview 생성량 절감과 구별 |
| 실제 app ROI | 선택 실험, 기본 off | tensor input crop 크기 감소를 기록. 큰 bbox는 full baseline; 원본 밖 최종 pixel copy |
| CropAndStitch | 고정 소스 예제 통합 | 실제 GPU36건/CPU8경계사례 완료. 이번 app ROI 측정9쌍은 픽셀동일. 기본 backend 교체 근거는 부족 |
| 타일/쿼드트리/LOD | CPU 계획 실험 | 공간 분할 이득과 overlap 비용만 확인. 전역 attention, 경계, 얼굴·문자 품질 검증이 없어 GPU 실행 보류 |
| WaveSpeed/FBCache | 다운로드/검토, off | generic UNet 코드가 있으나 선택 모델 wrapper+품질+skip 실측 전에는 활성화하지 않음 |
| TeaCache/DeepCache | 보류 | 다른 모델 adapter와 품질 보정 필요. 현재 경로에 근거 없이 추가하지 않음 |
| torch.compile/융합/정밀도 추가 축소 | 보류 | 짧은 SD Turbo에서 compile 준비 비용과 shape 다양성 이득 미확인 |
| 스칼라 사칙연산으로 행렬곱 대체 | 미채택 | GPU tensor kernel보다 빠르다는 근거 없음 |

## 소유권과 취소

모든 입력은 snapshot을 만들고 브라우저 session별 revision을 증가시킵니다. queued/running/canceling/canceled/succeeded/failed/uncertain을 구분합니다. 제출 응답을 잃으면 uncertain으로 표시하고 자동 재제출하지 않습니다. history 재조회와 WebSocket 재연결은 읽기 전용입니다. 다른 사용자의 GPU 작업을 끊을 수 있는 전역 interrupt는 호출하지 않습니다.

cache 저장은 job manager의 revision/cancel lock 아래 성공 확정 시 수행합니다. 소비자 간 공유 생성 중복 제거는 아직 구현하지 않았으며, 한 작업 취소가 타 작업 실행을 중단하지 않습니다. 결과 PNG/recipe는 job별 독립 경로이므로 실패 후에도 분석 가능한 중간 파일이 남을 수 있습니다. 성공 API는 succeeded job만 노출합니다.

## 정확한 의존성 정책

관리 서버는 프로세스 시작 token, 실행 옵션, Comfy/허용 custom node source fingerprint를 확인합니다. 모델은 매 요청 전체 SHA256을 읽으며 mtime/크기만으로 동일성을 판단하지 않습니다. 캐시 off에서도 관리 모델 검사를 수행해 Comfy 내부의 오래된 weight cache가 앱 cache를 오염시키는 경로를 막습니다. 모델 변경은 서버 재시작이 필요합니다.

앱 source는 시작 시 fingerprint를 고정하고 실행 중 변경 시 재시작을 요구합니다. 현재 디스크의 새 source와 메모리의 이전 Python 코드가 하나의 key를 공유하지 않습니다. 이 엄격한 비용은 benchmark에 포함합니다. 여러 앱·임의 custom nodes가 관리 서버를 동시에 변경하는 사용 방식은 지원하지 않습니다.

선택 정책 `windows_read_lock`은 Windows CreateFile의 `GENERIC_READ + FILE_SHARE_READ`로 파일과 상위 경로를 잡고 동일 핸들로 한 번 SHA256을 계산합니다. 일반 파일 쓰기·삭제·교체와 부모 폴더 교체를 차단한 동안 검증 hash를 재사용합니다. mtime 판정이 아닙니다. 잠금을 얻지 못하면 strict 전체 hash 정책으로 돌아가고 hash 불일치는 실행을 거절합니다. 장치·네트워크·alternate stream 경로는 거절하며 reparse point는 잠금 실패로 처리합니다. 일반 읽기·read-only mmap과 다른 파일 수정은 허용됩니다. raw volume/특권 kernel/적대적 filesystem 보장은 아닙니다. 모델 변경 전에는 앱을 종료해야 합니다. 프로세스·소스·설정 검사는 여전히 매 요청 수행합니다.

전체 checkpoint hash는 포함된 UNet/CLIP/VAE를 묶습니다. 별도 VAE/LoRA/ControlNet/IP-Adapter/tokenizer loader, 외부 embedding 문법, 알 수 없는 node는 exact cache에서 fail closed 처리합니다. 입력 원본·mask·crop·halo·seed·sampler·scheduler·steps·CFG·denoise·dtype·backend·adapter source·composite recipe가 key에 반영됩니다.

## 아직 검증하지 않은 것

인물 정체성/손/작은 문자/여러 LoRA를 포함한 고정 holdout 품질 평가, 안정적인 p95 추정, CUDA kernel별 event 계측, VRAM allocated/reserved peak, 광범위한 타일 seam/전역 조명, 근사 cache threshold는 후속 단계입니다. 이를 현재 기능의 속도/품질 성과로 간주하지 않습니다.
