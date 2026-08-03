# V 게이트(V1~V7) 현황 검증 — 증거 보고서

검증 시각: 2026-08-03 16:20 (Asia/Seoul)
검증 HEAD: `c0b87bb9b` (브랜치 `liora/conductor-jmscw1txf3umbok`, 격리 worktree)
체크리스트 기준 커밋: `4fcf9e0b4` — HEAD는 기준 이후 12커밋 진행 (아래 §0 참조)
근거 문서: `docs/specs/2026-08-03-v2-acceptance-checklist.md` (판정 기준), `docs/specs/2026-08-03-meta-orchestrator-v2-contract.md` §9
검증 성격: **현황 검증(증거 수집)** — 코드 수정 없음, 테스트 실행 + 정적 확인만 수행.

---

## 0. 기준 커밋 이후 변경 사항 (게이트 진행에 직접 영향)

| 커밋 | 내용 | 영향 게이트 |
|---|---|---|
| `733bd358a` | conductor 프로필 delegation-only (변경 도구 제거) | V1-1 |
| `e658c8b5a` | conductor 런타임 가드 + 블로킹 트리프와이어 (`conductor-guard.ts` 452줄, 테스트 2종) | V1-2~V1-4 |
| `9f00c23be` | 비대기 Job 런타임 강화 + 워커 모델 폴백 (`subagent-model-fallback.test.ts` 신규) | V2-3, V7-2 |
| `1a03ba66f` | 컨트롤 타워 job desk 보드 뷰 (`components/job-board/`, 테스트 3파일) | V5 |
| `84d482cb2` | collaboration 재수출 심 + swarm 도구 서피스 삭제 (심 22파일) | V6-1 |
| `4100b50ee` | job desk 오프로드 워커 + 프로토콜 job events v2 | V4 |
| `0df2de380` | dangling collaboration import 재지정 (src 2파일만) | V6-1 |
| `c0b87bb9b` | orchestratorMode 스택 + SpawnWorker 브리지 폐기 (S3-R3, −1055줄) | V6-2 |

## 1. 판정 요약

판정 용어: **통과** = 체크리스트 판정 기준 충족 / **부분** = 관련 코드·테스트 존재하나 기준 미달 / **미충족** = 부재 또는 기준 위반.

| 게이트 | 항목 | 판정 | 한 줄 근거 |
|---|---|---|---|
| V1 | V1-1 화이트리스트 스냅샷 | **부분** | Write/Edit/ApplyPatch 제거+스냅샷 그린이나 `RunProjectChecks`/`Agent`/`Fleet` 잔존 |
| V1 | V1-2 가드 거부 계약 | **통과** | 2단계 가드(이름+접근) 구현·배선·계약 테스트 그린 |
| V1 | V1-3 에스컬레이션 | **부분** | 3회 턴 종료 구현·그린 / 2회 원장 자동 기록 없음 |
| V1 | V1-4 벽시계 트리프와이어 | **부분** | 소프트/하드 예산 '관측' 그린 / 초과 호출 강제 중단 없음 |
| V1 | V1-5 Bash 읽기 전용 | **부분** | 정책+일반 테스트 존재 / conductor 전용 hard-deny 테스트 0건 |
| V2 | V2-1 ACK 데드라인 | **미충족** | ACK 경로에 `await scheduleQueuedJobs` 잔존 |
| V2 | V2-2 스폰 격리 | **미충족** | `WorkerSpawner` 큐/`spawning` 상태 부재 |
| V2 | V2-3 비대기 론칭 계약 | **부분** | 프로미스 상태 관찰 회귀 테스트 그린 / 수동 불리언 인자 잔존 |
| V2 | V2-4 await 정적 스캔 | **미충족** | 스캔 스크립트 부재 + 위반 패턴 실존 |
| V2 | V2-5 머지 오프로딩 | **미충족** | MergeJob이 `await landJobToMain` 인라인 머지 |
| V2 | V2-6 데모 계측 | **미충족** | 계측 로그 산출 절차·증거 없음 |
| V3 | V3-1 입력→ACK 계측 | **미충족** | TUI 계측 테스트 부재 |
| V3 | V3-2 큐잉 경로 소멸 | **부분** | 큐잉 경로 실존, 캐릭터라이제이션 테스트 0건 |
| V3 | V3-3 로딩 중 입력 보존 | **미충족** | 로딩 오버레이 입력 거부 경로 잔존 + 테스트 부재 |
| V4 | V4-1 주입 캡 | **통과** | 캡 단언 테스트 그린 (15건 파일) |
| V4 | V4-2 폭주 digest | **통과** | 10건→1건 에스컬레이션 + unread=1 시나리오 그린 |
| V4 | V4-3 스키마 이중 읽기 | **통과** | v1/v2 혼독·unknown-ignore 테스트 6건 그린 |
| V5 | V5-1 보드 기본 화면 | **부분** | 보드 컴포넌트+테스트 그린 / 기본 화면·프레임 예산·렌더 증거 없음 |
| V5 | V5-2 조작 증거 | **미충족** | 스크린샷/VerifySurface 증거 0건 |
| V5 | V5-3 보드 스토어 단일 소스 | **부분** | 구 델타 경로(`session-event/job-desk.ts`) 병존, 수렴 테스트 없음 |
| V6 | V6-1 R2 collaboration 심 | **부분** | src 심 삭제 완료 / 테스트 16파일 고아 import → 로드 실패 재현 |
| V6 | V6-2 R3 orchestratorMode | **부분** | 스택 삭제 완료 / 캐릭터라이제이션 없이 삭제 + `orchestratorMode` 잔재 + 스테일 레드 5건 |
| V6 | V6-3 R4 UltraSwarm | **미충족** | 대상 전체 실존 (`ultraSwarmRun` 비테스트 참조 47건) |
| V6 | V6-4 R5 AgentSwarm+서피스 | **미충족** | 도구·TUI 서피스·커맨드 전체 실존 |
| V6 | V6-5 R6 swarm 잔여 | **미충족** | `fleet/swarm-*.ts` 9파일 실존 (KEEP 2 포함) |
| V6 | V6-6 R7 최종 스윕 | **미충족** | `ultra*`/`orchestratorMode` 잔재 광범위 |
| V6 | V6-7 삭제 PR 게이트 | **부분** | ③④ 명령 존재·그린 / ①② 미배선 (V6-2가 첫 위반 사례) |
| V7 | V7-1 125초 재현 | **미충족** | 스폰 체인 120초 지연 주입 회귀 테스트 부재 |
| V7 | V7-2 403 라우팅 재현 | **부분** | 폴백·unhealthy 스킵 회귀 그린 / 403 수신→자동 마킹 경로 테스트 없음 |

**집계: 통과 4 / 부분 12 / 미충족 13** (V 게이트 29개 항목). 계약서 §9 기준 하나라도 미달이면 v2 미완료 → **현재 v2 미완료**.

### 계약서 §9 게이트 단위 환산

| 게이트 | §9 요구 | 현황 |
|---|---|---|
| V1 | 가드 테스트 스위트 그린 | ⚠️ 가드 계약은 구현·그린이나 R3 삭제 여파로 **스테일 테스트 5건 레드** (§3.1) |
| V2 | 정적 스캔 0건 + ACK p99 ≤ 250ms | ✗ 스캔 부재, await 잔존, 데드라인 테스트 없음 |
| V3 | 입력→ACK p95 ≤ 1초 계측 | ✗ 계측 없음 |
| V4 | 10건 폭주 → 메인 턴 ≤1회 + digest 1건 | ○ 테스트 수준 증명 (실시간 계측은 미수행) |
| V5 | 기본 화면 + 조작 증거 | ✗ 증거 없음 (보드 구현은 존재) |
| V6 | DELETE 전수 삭제 + grep 0건 + 래칫 그린 | ✗ R2/R3만 부분 진행, R4~R7 미착수 |
| V7 | 두 사고 레드→그린 증명 | ⚠️ 403 계열은 회귀 그린(레드 커밋 증빙 없음), 125초는 재현 테스트 없음 |

---

## 2. 항목별 증거

### V1 — delegation-only conductor

**V1-1 (부분).** `packages/agent-core/src/profile/default/conductor.yaml` L15-47: `Write`/`Edit`/`ApplyPatch`/`TaskOutput` 부재 확인. 그러나 체크리스트 부재 목록의 `RunProjectChecks`(L21), `Agent`(L44), `Fleet`(L45)는 여전히 등재. 스냅샷 테스트 `test/profile/conductor-delegation.test.ts` 3건 그린(실행 확인)이나 단언은 Write/Edit/ApplyPatch 부재 + 필수 도구 존재만 고정 — RunProjectChecks/Agent/Fleet 부재는 고정하지 않음. 참고: 런타임 가드가 `Agent`/`Fleet`을 `workerWaitBlocked`로 거부(conductor-guard.test.ts L48-60 그린)하므로 실제 위험은 `RunProjectChecks` 허용.

**V1-2 (통과).** `src/agent/conductor-guard.ts`(452줄) — ① 이름 기반 거부(고정 라우팅 문구 + `Suggested Job draft` 동봉), ② 접근 기반 판정(선언 없는 서드파티 도구 = write 간주 보수 판정). 배선: `src/agent/turn/step-loop.ts` L296-344 — `prepareToolExecution`에서 실행 **전** `{ output, isError: true }` 합성 결과 반환, `authorizeToolExecution`에서 권한 정책보다 먼저 차단. 테스트 `test/tools/conductor-guard.test.ts` stage 1·2 전부 그린(실행 확인), `test/agent/conductor-guard-agent.test.ts` 가드 활성화 범위(메인+conductor 한정) 그린.

**V1-3 (부분).** 3회 위반 턴 강제 종료: 구현·그린 (`conductor-guard.test.ts` L137-161, `CONDUCTOR_TURN_STOP_VIOLATIONS`). 2회 위반 시 가드가 원장에 `queued` Job 초안을 **직접 기록**하는 기능 부재 — `conductor-guard.ts:379`에서 `jobDraft`를 거부 출력에 제안만 함(원장 기록 없음).

**V1-4 (부분).** 벽시계 예산 관측 구현·그린 (`conductor-guard.test.ts` L164-193 'wall-clock tripwire (G3-lite)', 소프트/하드 이벤트). 그러나 하드 예산 초과 시 **실행 중 호출 중단 + `isError` 반환** 미구현 — `endToolBudget`은 `finalizeToolResult`(실행 종료 후, step-loop.ts:345-347)에서 정산만 함. 3회 연속 트리프 턴 종료·진단 리포트 없음.

**V1-5 (부분).** 정책 `src/agent/permission/policies/tool-read-only.ts` 존재, 일반 테스트 2파일(`test/agent/permission/{,policies/}tool-read-only.test.ts`) 존재. conductor 대상 쓰기 명령 hard-deny 테스트는 grep 0건.

### V2 — 비동기 위임, 동기 대기 0건

**V2-1 (미충족).** `src/tools/builtin/job/job-tools.ts:196` — JobCreate 실행 본문에서 `const schedule = await scheduleQueuedJobs({...})` 후 ACK 구성(L207~). L175 `await launchJobWorker(...)` (스폰 핸드셰이크 대기), L505에도 동일 패턴. 병렬 승격 완화(`job-ledger.test.ts` L659 'promotes queued jobs concurrently' 그린)는 있으나 ACK가 스케줄 펌프를 await하는 구조 자체는 미변. 지연 주입 p99 ≤ 250ms 단언 테스트 없음.

**V2-2 (미충족).** `WorkerSpawner` 큐, `spawning` 상태, 스폰 예산 30초 — `packages/agent-core/src` 전체 grep에서 해당 심볼 0건(주석·카탈로그 내 일반어 'spawning'만 매칭).

**V2-3 (부분).** `assertNonBlockingLaunchContract`가 수동 불리언 인자로 잔존 (`src/tools/builtin/job/job-lanes.ts:79`). 다만 실제 프로미스 상태를 관찰하는 회귀 테스트는 존재·그린: `test/tools/job-ledger.test.ts:610` 'JobCreate ACK returns before worker completion' — 미해결 completion 프로미스를 주입하고 ACK 시점에 워커가 alive(터미널 상태 없음, inbox 0건)임을 단언. criterion의 "수동 인자 경로가 남으면 불합격" 조항 기준으로는 부분.

**V2-4 (미충족).** `packages/agent-core/src/tools/builtin/job/**`에서 `await` 위반 패턴 실측: `launchJobWorker` await 5건(job-tools.ts:175,515 / job-worker.ts:310,410 등), `landJobToMain` await 1건(job-tools.ts:439). 이를 잡는 lint/스크립트는 `scripts/` 전체 grep 0건.

**V2-5 (미충족).** `job-tools.ts:439` `const land = await landJobToMain({...})` — MergeJob 도구 경로에서 인라인 머지 실행. kind=`merge` 랜딩 워커 분리 없음.

**V2-6 (미충족).** 계측 로그 산출 절차 없음. `docs/specs/2026-08-03-conductor-evidence.md` G2 항목이 "Live TTY/LLM demo not possible in this environment — test is the evidence"로 코드 수준 테스트만 인정한다고 명시 — 체크리스트 V2-6(메인 턴 벽시계 ≤ 3초 계측 로그) 기준 미충족.

### V3 — 입력 항상성

**V3-1 (미충족).** 입력→ACK 렌더 p95 계측 테스트 부재. 큐잉 경로 `apps/liora/src/tui/controllers/transcript/message-dispatch.ts` `enqueueMessage`(L125,192,252,280)는 그대로 실존.

**V3-2 (부분).** `enqueueMessage` 경로 실존(위), `apps/liora/test` 전체에서 `enqueueMessage` 참조 0건 — 캐릭터라이제이션 없음. 분류기 루프(입력→분류→ACK) 미구현.

**V3-3 (미충족).** 로딩 오버레이 중 입력 거부 경로 실존: `apps/liora/src/tui/controllers/session/session-browser.ts:221,233,389` `isReplaying || isSessionLoadingOverlayActive()` 가드. 입력 보존(원장 접수) 후 처리 테스트 없음.

### V4 — 알림/인박스 오프로딩

**V4-1 (통과).** `src/agent/injection/job-desk.ts` `JOB_DESK_MAX_CHARS`(1500)/MAX_EVENTS(5) 캡 + `test/tools/job-desk.test.ts` L199~ 'job desk injection caps (V4-1)' — 주입 텍스트 `≤ JOB_DESK_MAX_CHARS` 단언, ≤5 이벤트 캡, 배치 표시. 파일 15건 전체 그린(실행 확인). 체크리스트 기준이던 "테스트 0건" 상태에서 충족으로 전환.

**V4-2 (통과, 테스트 수준).** `src/tools/builtin/job/job-desk.ts`(210줄): `shouldOffloadInboxToDesk`(5분 창 ≥5건 burst 판정), `runDeskDigestCycle`, `enqueueDeskDigestJob`, kind=`desk`. 시나리오 그린: 완료 10건 → `batched: 10`, 에스컬레이션 카드 정확히 1건(`digest: true`), digest 후 unread = 1건(메인 턴 증가 ≤1) (`job-desk.test.ts` L93-108). 주의: 실제 워커 실행 계측이 아닌 단위/시나리오 테스트 증거.

**V4-3 (통과).** `packages/protocol/src/__tests__/job-events.test.ts` 6건 그린(실행 확인): v2 진행 필드(phase/recent tools/heartbeat) 파싱, `kind: 'desk'` + digest 마커, **v1 journal dual-read**(schemaVersion 1 이벤트 파싱), unknown v2+ 필드 무시. `protocol/src/events/job.ts` +61줄(v2 필드).

### V5 — 컨트롤 타워 TUI

**V5-1 (부분).** 보드 구현 존재: `apps/liora/src/tui/components/job-board/job-board.ts`(556줄) + helpers, `controllers/panes/job-board.ts`(150줄). 테스트 그린: `job-board.test.ts` 3건 + `job-board-helpers.test.ts` 3건 + `job-strip.test.ts` 7건(실행 확인). 미달: ① 체크리스트 지정 경로 `features/control-tower/` 미사용(경로 편차), ② 세션 시작 **기본 화면** 배선 증거 없음(`JobBoardController.show()`는 트리거 시 호출, liora-tui.ts:46), ③ 프레임 예산(16ms 셀 무효화/스트림 코얼레싱) 증빙 없음('frame primitive' 주석 구간만 존재), ④ 스크린샷/VerifySurface 증거 없음.

**V5-2 (미충족).** needs_user 상단 고정/peek/attach/큐 패널/Esc 복귀 조작 증거(스크린샷·VerifySurface) 0건.

**V5-3 (부분).** 보드 컴포넌트가 이벤트를 소비하나 구 델타 경로 `apps/liora/src/tui/controllers/session-event/job-desk.ts`가 존속(1a03ba66f에서 +22줄 변경) — 이벤트 구독 소스 이중. 단일 스토어 수렴 계약 테스트 없음, `SessionEventJobDesk` 흡수·폐기 미확인.

### V6 — 레거시 폐기

**V6-1 (부분).** 심 삭제 완료: `84d482cb2`가 `src/collaboration/index.ts`(16줄) + `src/tools/builtin/collaboration/*.ts` 재수출 심 22파일 삭제, 실체 모듈은 `fleet/`로 이관 완료(`fleet/ask-user.ts` 등 실존 확인). `check:imports` 그린(실행 확인). **그러나** `packages/agent-core/test`에서 `src/tools/builtin/collaboration` import가 **16파일** 잔존 → `test/tools/ask-user.test.ts` 모듈 로드 실패 재현: `Cannot find module '../../src/tools/builtin/collaboration/ask-user'`. 판정 기준 "심 이름 import grep 0건" 미달.

**V6-2 (부분).** 삭제 완료: `c0b87bb9b`가 `tools/builtin/fleet/orchestrator.ts`(520줄), `agent/orchestrator.ts`(109줄), `tools/builtin/job/job-fleet-bridge.ts`(43줄), RPC 필드(`rpc-methods.ts`, `payloads-agent.ts`, `interfaces.ts`, `session/rpc.ts`) 삭제(−1055줄). 미달 3건: ① 캐릭터라이제이션 테스트 없이 삭제(§6.2 가드레일 ①② 미준수 — V6-7 프로세스의 첫 위반 사례), ② `orchestratorMode` 잔재: `packages/protocol/src/events/agent.ts:61,117`, conductor 가드·테스트, `apps/liora/test/tui/commands/fleet-settings.test.ts` 등, ③ 삭제 후 스테일 테스트 레드 5건(§3.1).

**V6-3 (미충족).** UltraSwarm 실존: `tools/builtin/fleet/ultra-swarm-*.ts` 13파일 + `ultra-swarm.ts`/`.md`, `session/ultra-swarm-*.ts` 5파일(consensus/critic/debate/debate-cycle/restaff), `agent/ultra-swarm-run.ts`, `agent/plan/ultra-swarm-{decision,engage-gate,routing}.ts` 3파일. `ultraSwarmRun` 비테스트 참조 47건. 회복 시나리오 3종 없음.

**V6-4 (미충족).** `tools/builtin/fleet/agent-swarm.ts`, `apps/liora/src/tui/features/agent-swarm/`, `commands/swarm/`, `commands/ultrawork/`(7파일) + ultrawork 렌더/이벤트/appearance 파일 실존. fan-out 대체 증명 테스트 없음. (참고: `commands/swarm/orchestrator.ts`는 c0b87bb9b에서 삭제됨.)

**V6-5 (미충족).** `packages/agent-core/src/fleet/swarm-*.ts` 9파일 실존: 삭제 대상 7(bus-coordination, humanize, maker-checker + REBUILD 4종 dag-scheduler/run-ledger/budget/cost-guard) + KEEP 2(file-lease, evidence-gate). 단일 원장 계약 테스트 없음.

**V6-6 (미충족).** `ultra*` 잔재: 위 V6-3/V6-4 대상 전체 + `skill/builtin/ultrawork.*`, `tools/builtin/state/ultrawork-graph*`, `rpc/session-agent-methods-goal-ultrawork.ts` 등. `orchestratorMode` 잔재: V6-2 ② 참조. (참고: `agent/plan/ultra-plan-*`은 인벤토리 B장 DELETE 대상이 아닌 별도 기능이므로 스윕 범위 해석 시 구분 필요 — 체크리스트 "ultra* grep 0건" 문구와의 충돌은 게이트 개정 절차에서 정리해야 함.)

**V6-7 (부분).** ③ `pnpm run check:imports` 그린(이번 검증에서 실행, "Workspace import check passed"), ④ `pnpm run check:test-baseline` + `meta/test-baseline.yaml` 존재. ① 캐릭터라이제이션 ② 대체 증명은 미배선이며, V6-2 삭제가 이미 가드레일 ①② 없이 수행됨.

### V7 — 사고 재발 방지

**V7-1 (미충족).** 스폰 체인(`subagent-host.ts` `ensureAgentResumed`→`assertContractCompiles`→`createAgent`)에 120초 지연을 주입해 ACK ≤ 250ms를 단언하는 회귀 테스트 부재. 관련 가장 근접 증거는 `job-ledger.test.ts:610`(ACK가 completion 전에 반환)과 evidence 문서의 사후 분석("125초 블록은 Job 경로 밖 직접 Agent 스폰 기인", `2026-08-03-conductor-evidence.md` Hardening run) — 체크리스트가 요구하는 지연 주입 재현·레드→그린 증명이 아님.

**V7-2 (부분).** 그린 증거: `test/utils/cheap-model.test.ts` 15건 — explore 프로파일 폴백 체인(explicit explorationModel → cheap 추정 → 부모 모델), unhealthy explorationModel 스킵(`isAliasHealthy`) (실행 확인). `test/session/subagent-model-fallback.test.ts` 5건 — 'never hops into a provider already marked dead (regression: explore model 403)' 포함, `sharedCredentialHealthStore` 기반 실패 프로바이더 필터링 (실행 확인). 미달: 403 **수신 시** 해당 alias를 자동으로 unhealthy 마킹하는 경로의 테스트 없음(기존 테스트는 health store/체크를 직접 주입), 레드→그린 커밋 증빙 없음.

---

## 3. 부록

### 3.1 이번 검증에서 실행한 명령과 결과

| 명령 | 결과 |
|---|---|
| `pnpm -C packages/agent-core exec vitest run test/profile test/tools/conductor-guard.test.ts test/agent/conductor-guard-agent.test.ts test/tools/job-desk.test.ts test/tools/job-ledger.test.ts test/session/subagent-model-fallback.test.ts test/utils/cheap-model.test.ts test/tools/ask-user.test.ts` | **133 passed / 5 failed** (12파일 중 3파일 실패) |
| `pnpm -C packages/protocol exec vitest run src/__tests__/job-events.test.ts` | **6 passed** |
| `pnpm -C apps/liora exec vitest run test/tui/components/job-board.test.ts test/tui/components/job-board-helpers.test.ts test/tui/utils/job-strip.test.ts` | **13 passed** |
| `pnpm run check:imports` | **passed** |

실패 5건(전부 `c0b87bb9b` R3 삭제 이후 갱신되지 않은 스테일 테스트 — 가드 회귀가 아님):

1. `conductor-guard-agent.test.ts` 'blocks orchestratorMode entry on the conductor lane and records it'
2. `conductor-guard-agent.test.ts` 'forces orchestratorMode off when the conductor profile is applied later'
3. `conductor-guard-agent.test.ts` 'keeps orchestratorMode available on non-conductor main profiles'
4. `conductor-guard.test.ts` 'rejects worker-lifecycle waiting tool SpawnWorker'
5. `conductor-guard.test.ts` 'records blocked orchestratorMode entry attempts' (`TypeError: guard.recordOrchestratorModeBlocked is not a function`)

추가 로드 실패 1건: `test/tools/ask-user.test.ts` — `Cannot find module '../../src/tools/builtin/collaboration/ask-user'` (V6-1 고아 import).

### 3.2 GF(소스-인스톨 게이트) 참고 현황

이번 검증 범위 밖이나 확인된 사실: GF-1~GF-6 명령 전부 존재. `check:imports`(GF-3)는 이번 실행에서 그린. `docs/specs/2026-08-03-conductor-evidence.md`에 금일 GF 전 단계 통과 기록 있음(빌드/스모크/래칫 4781/4791) — 단, 그 이후 커밋(84d482cb2~c0b87bb9b)에 대한 재실행 기록은 없음. V6-1 고아 import 16건은 GF-1/빌드에는 영향이 없으나 agent-core 테스트 스위트 실패 요인.

### 3.3 미충족·부분 항목 남은 작업 목록

**즉시(게이트 레드 해소)**
1. 스테일 테스트 5건 정리: `orchestratorMode`/`SpawnWorker` 제거에 맞게 conductor-guard 테스트 2파일 갱신(삭제된 기능 단언 제거 또는 새 계약으로 대체). 계약서 V1 "가드 스위트 그린"의 전제.
2. V6-1 고아 import 16파일 재지정(`src/tools/builtin/collaboration/*` → `fleet/*` 이관 모듈) + 재실행 그린.

**V1**
3. V1-1: conductor.yaml에서 `RunProjectChecks`/`Agent`/`Fleet` 제거(또는 계약 개정으로 허용 목록 확정) + 스냅샷 단언에 부재 목록 추가.
4. V1-3: 2회 위반 시 가드가 `queued` Job 초안을 원장에 직접 기록 + ACK하는 구현·테스트.
5. V1-4: 하드 예산 초과 시 실행 중 호출 중단 + `isError` 반환, 3회 연속 트리프 턴 종료 + 진단 리포트 (시간 가상화 테스트).
6. V1-5: conductor 대상 Bash 쓰기 명령 hard-deny / 읽기 전용 허용 테스트.

**V2**
7. V2-1: 원장 도구 ACK 경로에서 `await scheduleQueuedJobs` 분리(ACK 후 백그라운드 펌프) + 지연 주입 p99 ≤ 250ms 테스트.
8. V2-2: `WorkerSpawner` 큐 + `spawning` 전이 이벤트 + 스폰 예산 30초 초과 `blocked` 기록.
9. V2-3: `assertNonBlockingLaunchContract` 수동 불리언 제거 → 런타임 관찰로 대체.
10. V2-4: `job/**`+conductor 경로 await 정적 스캔 스크립트 신설 + 위반 0건 수렴(인벤토리 A장 매핑).
11. V2-5: MergeJob 판정/실행 분리(kind=`merge` 랜딩 워커) + 도구 반환 시간 단언 테스트.
12. V2-6: 워커 3개 동시 실행 메인 턴 벽시계 ≤ 3초 계측 절차 구축 + 로그 첨부.

**V3**
13. V3-1: 입력→ACK 렌더 p95 ≤ 1초 TUI 계측 테스트.
14. V3-2: 현 큐잉 경로 캐릭터라이제이션 → 분류기 루프 교체 → 경로 삭제 + 폴백 `job_create` 수렴 테스트.
15. V3-3: 로딩/리플레이 중 입력 보존(원장 접수) 후 처리 테스트.

**V5**
16. V5-1: 보드를 세션 시작 기본 화면으로 배선 + 프레임 예산(16ms/코얼레싱) 구현·증빙 + 렌더 증거(스크린샷/VerifySurface).
17. V5-2: needs_user 고정/peek/attach/큐/Esc 조작 증거 각 1건+.
18. V5-3: 보드 스토어 단일 소스 수렴 + `SessionEventJobDesk` 폐기 + 계약 테스트.

**V6**
19. V6-2 잔재: `orchestratorMode` 프로토콜 필드/플래그 완전 제거(가드 기록 방식 이관) — 또는 게이트 개정으로 "진입 차단용 잔존" 명시. 캐릭터라이제이션 생략에 대한 소급 가드레일(대체 증명 테스트) 보강.
20. V6-3~V6-5: R4(UltraSwarm 캐릭터라이제이션 + Mission 회복 3종 → 삭제), R5(AgentSwarm 대체 증명 + 서피스 동시 삭제), R6(swarm 7모듈 삭제/흡수 + 단일 원장 계약) — 전체 미착수.
21. V6-6: R2~R6 완료 후 ultra*/orchestratorMode 스윕 + `check:test-baseline` 갱신. (ultra-plan* 스윕 범위 해석 정리 선행.)
22. V6-7: 삭제 PR 4종 가드레일(캐릭터라이제이션/대체 증명/참조 0건/래칫) 프로세스 배선.

**V7**
23. V7-1: 스폰 체인 120초 지연 주입 회귀 테스트(레드) → G1/G2 적용 후 ACK ≤ 250ms(그린) 증명.
24. V7-2: 403 수신 → alias 자동 unhealthy 마킹 → 재라우팅 차단 경로 단위 테스트 보강.
