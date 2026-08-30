---
name: worker-routing-parent-pool
description: "Predictable worker role-based model routing with parent-same-model inheritance toggle and user-selectable allowed model pool, enforce priority explicit pin > parent inherit > allowed pool > harness default, and expose selection reason for UX consistency."
whenToUse: "Use when conductor LLM routing picks random unintended provider/model, when adding parent-same-model option, or when implementing customizable allowed model pool in settings."
triggers:
  - "worker routing"
  - "model pool"
  - "parent inherit"
  - "conductor routing"
  - "JobCreate model_alias"
  - "fleet_model_catalog"
  - "allowed models"
  - "routing predictability"
type: prompt
source: auto
risk: low
---

# Worker Role Routing — Parent Inherit + User Pool

1. RepoQuery로 라우팅 코드 위치 규명: `conductor`, `scheduler`, `fleet_model_catalog`, `JobCreate model_alias` 키워드로 `packages/server`, `packages/agent-core` 탐색. 코드 덤프 전 RepoQuery 필수.
2. 설정 저장소 정의: `packages/server` + `apps/liora`에 허용 모델 풀 스키마 추가. 저장 위치 예: `~/.superliora/config` 또는 앱 설정 파일. 비밀값 금지, 모델명(alias)만 저장. 비어있으면 전체 풀 폴백 + 경고.
3. Job 생성 시 부모 상속 구현 — 아래 정확한 JobCreate 형태로 검증됨:
   - `kind: "implement"`
   - `affinity: "off"`
   - `context_paths: ["AGENTS.md","packages/agent-core/AGENTS.md","apps/liora/AGENTS.md","packages/server/AGENTS.md"]`
   - `ownership_paths: ["packages/server","packages/agent-core","apps/liora","packages/kosong"]`
   - `title: "워커 역할별 라우팅 — 부모 동일 모델 상속 + 유저 모델 풀 커스터마이징"`
   - prompt에 우선순위 명시: `명시적 핀 > 부모 상속 > 허용 풀 > 기본 하네스 선택`
4. 라우팅 엔진 수정: 선택 로직을 설정 기반 필터로 확장. 하드코딩 if-else 금지, adapter/registry 패턴 사용. `fleet_model_catalog`의 live-healthy alias 목록 안에서만 선택, 존재하지 않는 alias 발명 금지. `model_alias`가 명시되면 최우선, 없으면 `continue_from_job_id` 부모 모델 상속, 없으면 유저 허용 풀 필터, 마지막에만 하네스 기본 선택.
5. 예측 가능성 로그 노출: 선택된 모델과 사유를 로그/상태에 기록 `explicit-pin | parent-inherit | user-pool | default`. 설정 변경 시 즉시 반영 또는 재시작 안내.
6. Memory에 1~2문장 선호로 저장: Memory tool로 "워커는 부모 동일 모델 우선, 라우팅은 허용 풀 안에서만 선택, 우선순위 explicit pin > parent inherit > allowed pool" 형태로 저장.
7. 검증: `pnpm run test:local` 및 관련 패키지 단위 테스트. 테스트 케이스: 부모 상속, 허용 풀 필터링, 빈 풀 폴백, 우선순위 충돌, 로그 사유 노출.

Done when:
- 워커가 `부모와 동일` 옵션 ON 시 `continue_from`/자식 Job에서 부모 `model_alias`를 상속함
- 세팅에서 유저가 프로바이더/모델 체크박스로 허용 풀을 선택/저장할 수 있음
- 라우팅이 허용 풀 밖 모델을 선택하지 않고 우선순위대로 동작하며 로그에 사유가 노출됨
- 기존 테스트가 통과하고 신규 단위 테스트가 추가됨

What not to do:
- 모델명 if-else 하드코딩, fleet_model_catalog 밖 alias 발명, unhealthy alias 재시도 금지
- 설정 파일에 API 키/토큰 저장 금지
- `packages/agent-core` 직접 import 금지 등 AGENTS.md 아키텍처 위반 금지
- affinity 충돌 경고를 무시하고 동일 `ownership_paths`에 병렬 cold-spawn 금지 — 필요 시 `affinity: "off"` 또는 `continue_from_job_id` 사용
