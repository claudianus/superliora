---
"@superliora/agent-core": minor
---

컴팩션 요약을 증거와 연결합니다. 요약 계약에 `verified_claims` 섹션을 추가해 완료/검증 주장마다 증거(테스트 ID, 로그 경로, 명령)와 `needs_revalidation` 여부를 남기고, 재개 시 `needs_revalidation=true` 주장은 값싼 재확인(테스트·타입체크·git 상태)을 권하는 리마인더를 한 번 주입합니다. 또한 `archive_ids`와 `evidence_ids` 목록은 상위 5개만 컨텍스트에 싣고 전체 목록은 `<homedir>/compaction/` 사이드카 파일로 빼내어(kind별 LRU 32개 유지) 긴 세션의 요약 팽창을 줄입니다.
