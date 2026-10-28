# Pankeki 공식 대회 제출 요건 확인

> **2026-10-22 재확인:** 현재 공식 App requirements는 완전 로컬 ComfyUI 실행도 허용한다. 아래의 SDK/Router 필수 문구는 과거 확인 기록이며 현재 요건이 아니다. [현재 요건·전략](best-overall-strategy-20261022.ko.md)을 우선한다.

확인일 2026년 10월 20일 KST · 기획·리서치팀 → 총괄 및 출시·제출 담당

Open Source Higgsfield의 현재 공식 공고와 페이지가 직접 불러오는 요건 리소스를 확인했다. 마감은 **2026년 10월 30일 09시 PT**, 한국시간 **10월 31일 01시 KST**다. 아래는 공고상 제출 체크 항목이며 참가 적격·심사 통과 판정은 아니다. [공식 공고](https://comfy.org/open-source-higgsfield/)

## 현재 요건

| 구분 | 공식 공고에서 확인한 내용 |
| --- | --- |
| 구현 | Comfy Developer Platform의 Comfy Router 또는 Comfy SDK 사용. |
| 공개 저장소 | GitHub 앱 코드·워크플로 파일·OSS 라이선스·타인이 자기 컴퓨터에서 실행할 수 있는 안내. |
| 데모 | 최대 2분. 함께 사용한 도구·모델·기법 설명. |
| 소셜 | 데모 링크와 `#OpenSourceHiggsfield`를 포함한 게시물. 허용 플랫폼은 Reddit·X·Instagram·LinkedIn·YouTube·TikTok. |
| 실행 링크 | 배포 앱 또는 endpoint 링크는 선택이며 권장. |
| 콘텐츠 | 적법한 SFW 자료, 무허가 IP·인물 외형 사용 금지. |
| 출품 수 | 1인당 1개. |
| 소개 | 제출 시 주최·파트너의 크레딧 포함 작품 소개에 동의. |

근거는 [공식 공고](https://comfy.org/open-source-higgsfield/)의 How to enter와 [현재 요건 리소스](https://comfy.org/_website/translations.ttgZaWHe.js)의 영어 `eventChallenge`다. 읽기 도구에서 빈 제목으로 보이는 접힌 항목은 [공식 페이지 구성 요소](https://comfy.org/_website/HowToEnterSection.BgUUwldY.js)가 위 리소스의 requirement1~6와 Repo·Demo·Link·Social 항목을 렌더링함을 확인했다.

Best Overall은 모든 출품작이 자동 고려되며 상금은 10,000달러다. 상세 배점은 공개 공고에서 확인되지 않았다. Open Weights Only는 별도 조건으로, 공개 가중치만 사용하고 파트너 노드·비공개 API를 쓰지 않아야 한다. 이는 현재 Pankeki의 적격 판정이 아니다. [공식 상 부문 안내](https://comfy.org/open-source-higgsfield/)

## Pankeki에 적용할 때의 확인 상태

| 항목 | 현재 근거 | 총괄 및 출시팀에 남는 확인 |
| --- | --- | --- |
| SDK 사용 | 최신 체크포인트와 저장 9회에 앱 → 공식 SDK → proxy → ComfyUI 실행 기록이 있다. | 재개 환경의 가중치·실행기·manifest 확인 및 제출 대상 소스와 증거의 대응 확인. |
| 로컬 실행 경로 | 공식 SDK 문서는 자체 ComfyUI를 `comfy-api-proxy`로 연결하는 구성을 지원한다. 로컬 proxy 기본 주소는 `127.0.0.1:8189`, 키는 기본적으로 필요하지 않다. [공식 SDK 문서](https://docs.comfy.org/development/api-development/sdks#your-own-comfyui) | 계정·유료 클라우드·신규 모델 도입을 이번 기획의 선행 조건으로 추가하지 않는다. 복구 재현성은 환경·출시팀이 검증한다. |
| 코드와 안내 | 공통 인계상 공개 개발 스냅샷은 있다. 최신 로컬 SDXL 설정·관련 회귀는 공개 후 변경으로 기록됐다. | 공개본과 최신 소스 차이, 앱 OSS 라이선스·제3자 고지, workflow·설치 안내의 실제 포함 여부. |
| 시연 내용 | 후보 비교·부분 수정·저장 흐름이 제품 방향이며 대화 모델은 미연결이다. 전체 이미지 요구 통과는 0/9다. | 실제 사용 가능한 흐름을 보여 주고, 가짜 대화·가짜 생성·편집 품질 승인 없이 한계를 설명하는 데모. |
| 데모와 소셜 및 제출 | 이번 작업은 작성·게시·제출하지 않았다. | 제출 담당이 산출물과 링크를 확인하고 실제 제출 전 공식 원문 재확인. |

SDK 경로가 로컬 구성을 지원한다는 공식 설명과, Pankeki가 저장 실행에서 그 경로를 사용했다는 로컬 증거를 구분했다. 주최 측의 최종 적격 확인을 받은 상태는 아니다.

## 확인 범위와 재확인 지점

공식 공고에서 연결한 [신청 폼](https://form.typeform.com/to/Ayn9Cwfj)과 [제출 폼](https://form.typeform.com/to/V1dSQrkS)은 제목과 연결 대상만 확인했다. 읽기 결과에 동적 질문이 노출되지 않아 필수 입력 필드·개인 자격·추가 동의 문항은 확정하지 않았다. 제출 담당이 실제 폼에서 확인해야 한다. 입력·신청·제출은 수행하지 않았다.

현재 HowToEnter 구성 요소가 가리키는 번역 파일은 `translations.ttgZaWHe.js`다. 기존 `evidence/contest-translations.js`의 기록상 파일명 `translations.BRT8B3VB.js`와 달라 기존 파일만으로 최신 요건을 판정하지 않았다. HTTP 상태·URL·본문 해시·요건 키별 해시는 [공식 출처 확인 기록](../../work/team-resume/planning/official-source-check.json)에 보존했다. 원문 전체를 새 문서에 복제하지 않았다.

시간은 공고의 PT를 10월 30일 미국 서부 시간대로 해석해 변환했다. 변환 검증 명령과 결과는 [검증 기록](../../work/team-resume/planning/validation.json)에 있다. 심사 세부 배점·참가자별 자격·자동 수상 가능성은 추정하지 않는다.
