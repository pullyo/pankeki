# 이미지 모델 3종 로컬 비교 결론

2026-10-20 KST · 아지 총괄의 원출력·최종 합성본·비교판 직접 검토

7개 가중치27,827,319,993bytes의 공식 크기·SHA256 검증과 **3모델×4과제=12건의 실제 native 실행**을 완료했다. RTX5060 8GB에서 OOM·커널 미지원·cleanup 실패는 없었고 종료 후 GPU lock도 없다. 최종9개 편집의 마스크 밖 RGB/alpha와 전체alpha 오차는 모두0이다. 이는 공통 원본 합성의 결과이며 모델 원출력은 영역 밖도 바뀐다.

## 제품 적용 권장

- **빠른 생성·색 변경 후보: FLUX.2 Klein4B NVFP4.** 이번 생성은 장갑색·허리 소품 등 지시를 가장 잘 따랐고 색 편집도 사용 가능했다. 재질 편집의 큰 가방이 고정 마스크에 잘리고, 약한 미소 요청은 얼굴/그림체가 크게 바뀌었다.
- **재질·표정 등 수정 품질 후보: Qwen-Image2.1 Turbo INT8.** 붉은 가죽·바느질·버클과 절제된 미소가 다른 후보보다 요구에 가까웠다. 얼굴은 눈썹·눈·볼의 변화/매끈해짐이 남아 동일인 보장을 할 수 없다. 더 오래 기다릴 수 있는 수정용 후보로 권한다.
- **SDXL은 기존 SDK 기준선으로 유지.** 실행 기반은 있으나 이번 장갑색·재질·표정의 전체 요구를 충족하지 못했다. 이 결과로 새 기본 모델을 자동 전환하지 않는다.

## 실제 시간과 수용 기준

| 모델 | 첫 호출 파이프라인 범위 | 프로세스 시작~종료 범위 | 이번 수동 사용 가능 선별 |
| --- | --- | --- | --- |
| SDXL Base1.0 | 44.1~69.6초 | 88.6~114.9초 | 0/4 |
| FLUX.2 Klein4B | 34.1~40.5초 | 50.7~77.7초 | 생성·장갑색2/4 |
| Qwen-Image2.1 Turbo | 133.2~179.7초 | 161.7~254.4초 | 4/4, 얼굴 보존은 경계선 수용 |

사용 가능은 QA의 항목별0~3점 중 필수 항목2점 이상이라는 작은 과제 기준이다. 완벽한 의미/인물/경계 성공률이나 일반적인 모델 순위가 아니다. 모든 사례는 새 프로세스의 cold 호출이며 적재·CPU offload/CPU VAE가 포함된다. warm latency는 미측정이다. 모델별 양자화·설정·권장 step도 달라 가중치만의 비교로 해석하지 않는다. 수용 가능한 모델을 결정한 뒤 필요한 재검증 외에 추가 seed/GPU 실행은 하지 않았다.

현재 결과는 in-process Comfy node 실험이다. **앱의 공식 SDK 통합 성공이 아니며**, 새 모델의 SDK 그래프·취소·오류·준비 상태와 배포 조건을 확인한 후 제품에 적용한다. 기본 앱 모델이나 제품 코드는 이 비교에서 바꾸지 않았다. 메모리의 Torch allocated/reserved peak는 전체 장치 peak가 아니며 별도 프로세스/장치 표본과 구분해 보관했다.

## 실제 확인한 증거

- [12건 JSON](D:/Pankeki/work/model-comparison-20261020/qa/results.json), [CSV](D:/Pankeki/work/model-comparison-20261020/qa/results.csv), [사례별 시간·수용 요약](D:/Pankeki/work/model-comparison-20261020/qa/screening-summary.md)
- [생성 비교](D:/Pankeki/work/model-comparison-20261020/qa/boards/T01-character-comparison.png), [장갑색 원출력/합성](D:/Pankeki/work/model-comparison-20261020/qa/boards/E01-gloves-comparison.png), [소재 원출력/합성](D:/Pankeki/work/model-comparison-20261020/qa/boards/E02-material-comparison.png), [표정 원출력/합성](D:/Pankeki/work/model-comparison-20261020/qa/boards/E03-expression-comparison.png)
- [장갑 확대](D:/Pankeki/work/model-comparison-20261020/qa/boards/E01-gloves-detail.png), [소재 확대](D:/Pankeki/work/model-comparison-20261020/qa/boards/E02-material-detail.png), [표정 확대](D:/Pankeki/work/model-comparison-20261020/qa/boards/E03-expression-detail.png)
- 원 PNG·request·attestation·metrics·원시 stdout/stderr: `work/model-comparison-20261020/qa/runs/`. 총괄은 비교판의 raw/final과 세 상세 확대를 직접 확인했고 JSON12행·CSV12행·성공12개·출력 누락0·보존 지표 오류0·lock없음을 별도 읽기 점검했다.

모델 비교 완료 알림은 이 결론을 사용자에게 알린 뒤 PAUSED로 종료한다. 2D 움직임 구현은 별도의 승인된 작업팀 과제로 계속한다.
