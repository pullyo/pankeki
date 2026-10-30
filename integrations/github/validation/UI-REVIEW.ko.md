# 로컬 UI 검증 범위

2026-10-19에 `http://127.0.0.1:8190/`의 HTML을 실제 HTTP로 읽었고 `ui-http-20261019.html`에 보존했다. 응답은 12,228 bytes였다. 입력 validation·Host/Origin/content-type·빈 mask 오프라인 처리·취소/revision·실패 결과 접근 차단·투명 alpha·EXIF 방향은 `tests/test_server.py`의 실제 loopback HTTP 시험으로 확인한다.

브라우저 렌더링/screenshot/실제 pointer 브러시 동작은 확인하지 못했다. Aside CLI는 `uv_os_get_passwd returned ENOMEM`으로 실패했고, 내장 CUA도 초기화 두 번 실패 후 GPU 실험 종료 뒤 재시도에서 다음 진단을 반환했다.

```text
node_repl kernel exited unexpectedly
windows sandbox failed: permission path cannot be represented losslessly
```

당시 읽은 가용 RAM은 약13.9GB였으므로 단순 메모리 부족이라고 확정하지 않았다. 브라우저 sandbox 초기화 실패 때문에 screenshot이 생성되지 않았으며 HTTP 시험 결과를 시각/포인터 검증 완료로 표현하지 않는다. 사용자 프로세스를 종료하거나 sandbox 설정을 우회/변경하지 않았다.

정적 검토에서 발견한 client validation 실패가 기존 poll을 중지하는 문제, mask 파일이 이전 mask와 겹쳐지는 문제, raw 이미지 전달에 따른 EXIF 방향 문제는 root 구현에서 수정됐고 HTTP 회귀 범위에 반영했다. 리사이즈된 canvas의 pointer 매핑 코드는 원본 canvas 크기와 bounding client rectangle 비율을 사용하지만 실제 브라우저 화면에서의 클릭 일치 여부는 추가 확인이 필요하다.
