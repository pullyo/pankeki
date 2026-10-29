# Live2D에서 Pankeki에 적용할 원리

2026-10-20 KST 1차 분석. **우선 제안은 부위별 마스크 저장·잠금과 속성별 후보 기록 두 가지다.** 기존 PNG·편집 흐름을 활용하고, 레이어·리깅은 후속 조건으로 둔다. 아래의 Live2D 설명은 확인한 사실, Pankeki 대응은 제안이다.

## 핵심 기술 세 묶음

| 기술과 확인한 사실 | Pankeki에 적용할 원리 |
| --- | --- |
| **파츠 계층:** 눈·의상 같은 부품을 ID와 여러 단계 그룹으로 관리해 선택·표시·잠금을 묶는다. [공식 문서](https://docs.live2d.com/en/cubism-editor-manual/parts/) | 캐릭터→의상→양손 장갑/망토/가방으로 선택 대상을 나누고 마스크를 재사용한다. 그룹 생성만으로 실제 레이어가 분리되는 것은 아니다 |
| **파라미터와 키폼:** ID·범위·제어값과 각 키의 형태를 연결하고 사이 형태를 보간한다. 공개 모델 API도 ID 기반 parameter 제어를 제공한다. [문서](https://docs.live2d.com/en/cubism-editor-manual/parameter/), [공개 코드](https://github.com/Live2D/CubismWebFramework/blob/develop/src/model/cubismmodel.ts) | 색·재질·위치를 특정 부위에 결합하고 승인된 후보를 그 속성의 변형으로 기록한다. 독립 생성 PNG 두 장의 중간값이 실제 키폼 보간이 되지는 않는다 |
| **디포머와 ArtMesh:** 메시를 묶어 warp/회전하며 정점·텍스처로 형태를 표현한다. [디포머](https://docs.live2d.com/en/cubism-editor-manual/deformer/), [ArtMesh](https://docs.live2d.com/en/cubism-editor-manual/concept-of-artmesh/) | 분리된 소품의 위치·크기를 재생성 없이 조절하는 후속 후보다. 선택 계층과 변형 계층, 원본과 변환 좌표를 분리해 저장해야 한다 |

## 적용 아이디어 두 개

**1. 이름 붙인 부위와 수정 범위 잠금.** 후보에서 장갑 영역을 수동으로 칠해 이름을 저장하고 “장갑만 청록, 얼굴과 망토 유지”를 요청한다. 두 장갑 마스크의 합집합에서 잠근 영역을 제외해 편집하고, 기존 합성으로 바깥 픽셀을 보존한다. 필요한 데이터는 `Region{id, parentId, sourceVersionId, sourceHash, maskRef, locked}`와 `Attribute{regionIds, property, desiredValue, reviewStatus}`다. 원본 hash가 다른 후보에는 마스크를 조용히 재사용하지 않는다. **추론:** 객체와 속성을 명시적으로 묶으면 현재 색·소품 지시 실패를 더 좁은 수정 문제로 다룰 수 있다. 의미 품질 향상은 별도 검증해야 한다.

**2. 속성별 후보 북마크.** 같은 원본·같은 부위에서 “청록 장갑안”, “빨간 가죽 가방안”을 묶어 비교하고 승인/거절을 남긴다. 필요한 데이터는 `VariantGroup{sourceVersionId, regionIds, property, candidateIds, acceptedId}`와 기존 request snapshot·parentId다. 현재 `selectionHistory`는 view/edit/compare 이력이므로 승인 기록과 구분한다. “가죽→금속”은 범주형 변경이며 연속 slider나 영상 보간으로 포장하지 않는다.

## 필요한 조건과 실행 경계

**단일 PNG+수동 마스크로 가능:** 부위 등록·잠금, 선택 영역의 색 조정/부분 재생성, 후보 비교·승인 기록. 현재 `app.js`의 요청 snapshot, `workflows.py` 편집, `composite.py` 바깥 보존을 활용할 수 있다. 현재 `profiles.js`는 source/mask를 프로젝트 request에서 제외하므로 마스크 영속화에는 별도 asset 저장·포맷 migration·version1 호환 검토가 필요하다. 우선 판정은 저장/복원, 다른 원본에 mask 오적용 방지, 잠금 우선권, 마스크 밖 RGB와 전체alpha 오차0이다. 색·재질 준수는 이 기능 판정과 별개다.

**레이어·메시·리깅이 필요:** 소품을 옮겨 가려진 뒤쪽을 드러내기, 눈·입의 안정적 연속 변형, 머리카락 물리. 분리 alpha 소재와 가려진 부분의 추가 그림, UV/삼각형 topology·대응 키폼·rig가 필요하다. 공개 물리 코드는 입력/출력 parameter와 입자 설정을 시간에 따라 계산하며 PNG에서 이를 자동 추출하지 않는다. [물리 코드](https://github.com/Live2D/CubismWebFramework/blob/develop/src/physics/cubismphysics.ts)

공개 Framework는 별도 Core와 함께 내보낸 모델을 다루고, WebSamples는 physics 등의 updater 뒤 모델을 갱신한다. **Editor의 키폼 생성이나 Core 내부 변형 알고리즘을 확인한 결과는 아니다.** [Framework 설명](https://github.com/Live2D/CubismWebFramework), [WebSamples 코드](https://github.com/Live2D/CubismWebSamples/blob/develop/Samples/TypeScript/Demo/src/lappmodel.ts) 모든 링크 확인일2026-10-20 KST. 설치된 Cubism5.3.04는 총괄 확인을 인용했으며 이 담당은 Editor 조작·코드 복사·설치·제품 구현을 하지 않았다. 부위 등록 아이디어를 첫 검토 대상으로 권하며 총괄 검토를 기다린다.
