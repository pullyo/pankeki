## 최신 백업 지시 — 모델 제외 단일 ZIP

사용자가 이미지 모델 포함 여부를 확인한 뒤 모델 제외에 동의했다. 최신 백업은 D:/Pankeki-backup-20261020.zip 한 개이며, 실행 환경·작업물·인수인계와 모델 재다운로드 manifest만 포함한다. 모델7개 약27.8GB 원본은 D:/Pankeki/models에 그대로 보존한다. 이전 E/F 분산 계획과 모델 포함 계획은 중단된 이력이며 .partial 파일은 완료 백업이 아니다. ZIP의 Backup-Metadata/RESTORE.ko.md와 옆 검증 파일이 최신 복구 기준이다.

# 사용자 요청에 따른 작업 중단 및 인수인계

2026-10-20 Asia/Seoul. 사용자가 이미지 생성 중단, 팀 작업 중단, 작업물 GitHub 커밋·푸시, 나머지 실행 환경과 인수인계 파일의 E/F 드라이브 분산 백업을 지시했다. 이 지시가 이전의 자동 진행 및 일정 목표보다 우선한다.

- 기존 8개 담당 채팅 모두 중단 지시를 받았다. 추가 구현·디자인·연구·검증·이미지 생성·GPU 작업을 재개하지 않는다.
- `pankeki` 자동화는 사용자 지시에 따라 PAUSED로 변경했다.
- 사용자의 별도 재개 지시까지 대기한다. 중단을 완료나 승인으로 해석하지 않는다.

## 보존 위치

- 주 작업: `D:/Pankeki`. 원본 프로젝트에 git init을 하지 않았다.
- 공개 Git 저장소: https://github.com/pullyo/pankeki ; main 이력을 보존하는 게시용 checkout: `work/publication/github-checkout-20261020`.
- 기존 움직임 QA 빌드: `web/`, 원래 독립 검수 자료: `work/team-resume/motion-qa/ui-acceptance/` 및 `docs/handoffs/motion-qa-results.md`.
- 디자인 중간본: `work/design/liquid-glass-20261020/`; 최신 불투명 재배치 소스는 `reflow/web/`. 최종 화면 QA·실제 부위 썸네일/타임라인 연결·나머지 화면 통일 미완료. 공개본의 `previews/ui-reflow/`에 별도 저장한다.
- 실제 모델 비교 7개 가중치와 12회 실행은 완료됐다. 재다운로드/재추론을 반복하지 않는다. 보고서: `docs/research/technical/model-comparison-conclusion-20261020.ko.md`.
- 다른 F01~F09/D01/P01 미완료 과제는 `docs/product/feature-delivery-tracker-20261020.ko.md`에서 유지한다.

## 복구 시 주의

Git에는 모델·가상환경·사용자 결과·내부 인수인계 및 실행 로그가 없으며 E/F의 별도 아카이브를 사용한다. E는 약20.7GB, F는 약30.8GB 여유의 exFAT이므로 재생성 가능한 다운로드/pip 캐시와 미완성 전송 조각을 제외하고 압축한다. 확정된 모델 가중치 7개 및 설치 환경은 포함한다. 제외 목록과 모든 실제 파일 SHA256, 재분석점(심볼릭 링크/정션) 목록을 백업에 기록한다.

가상환경은 절대 경로와 원래 Python 설치 위치를 참조한다. 다른 PC에서는 포함된 Python/Node 정보와 lock 파일을 사용해 경로를 복구하거나 환경을 다시 만들어야 한다. pnpm 정션은 exFAT에서 직접 복원하지 말고 NTFS에 압축을 푼 뒤 포함된 링크 목록 및 고정 lock 파일로 복구한다. 기존 PID·localhost 포트·IndexedDB 브라우저 프로필은 복원 후 유효하다고 가정하지 않는다. 사용자 제공 원본 이미지는 변경하지 않는다.

## 검증 판정

움직임의 준비 PNG 예제·기본 저장/재개·정지 PNG·48 ZIP 일부 경로가 검수됐으나 전체 T9 수용 완료는 아니다. 사용자 분리 소재, 최대 부하/실제 디스플레이 성능, 전체 문서 교체 경쟁 조건 등의 미검증 목록은 QA 인계에 남아 있다. Codex 실제 대화 및 새 후보 모델의 제품 통합, 자동 리깅/분할/물리/추적은 미완료다.

GitHub main 원격 반영 확인: `943513c268ae3d4188711d7e3ca53a86d861b3fb`, 로컬 스냅샷과 Git tree가 동일하다. 세부 게시 기록은 work/publication/PUBLISHED-20261020.md. 백업은 E:/Pankeki-backup-20261020 및 F:/Pankeki-backup-20261020에 분산한다.
