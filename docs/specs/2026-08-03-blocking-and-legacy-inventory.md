# 블로킹 경로 & 레거시/중복 인벤토리

작성일: 2026-08-03
상태: Phase 0 산출물 (코드 조사 기반 인벤토리 — v2 계약서의 증거 첨부)
짝꿍 산출물: `docs/specs/2026-08-03-meta-orchestrator-v2-contract.md`
조사 기준 커밋: `4fcf9e0b4` (worktree HEAD, main 기준)

범위: 메인 루프(인터랙티브 레인)가 대기/블로킹될 수 있는 모든 코드 경로 + 병렬 오케스트레이션 중복 구현 전수.
각 항목은 파일/함수 단위까지 특정하고, 차단 방법(v2 가드 매핑)과 테스트 방안을 붙인다.

---

## A. 블로킹 경로 인벤토리

### A-0. 오늘 실제로 발생한 사고 (2건)

#### 사고 1 — 직접 스폰 125초 블로킹

- **현상**: 메인이 워커를 직접 스폰하는 경로에서 턴이 125초간 블로킹. 그 동안 사용자 입력은 TUI 큐로 밀림.
- **경로 재구성**: `JobCreateTool`/스케줄 또는 Fleet 직접 스폰 → `launchJobWorker` (`job-worker.ts:140`) → `spawnOneAgent` (`fleet/spawn-agents.ts:79`) → `SessionSubagentHost.spawn` (`subagent-host.ts:151`) → 순차 `await`:
  1. `session.ensureAgentResumed(ownerAgentId)` — 세션 재개 I/O
  2. `assertContractCompiles` — 계약 파일 컴파일 검사 (외부 프로세스, 레포 크기에 비례)
  3. `session.createAgent` — `prepareSystemPromptContext` (AGENTS.md 병합 등 파일 I/O)
  4. `runWithActiveChild` 기동 후 `configureSubagentChild` 내부의 프롬프트 컨텍스트 재구성
- **근본 원인**: "스폰은 가볍다"는 가정이 깨짐. 스폰 준비(프로파일 해석, 컨텍스트 구성, 계약 검사)가 전부 메인 턴의 await 체인에 연결됨.
- **차단 방법 (v2)**: 계약서 §3 G2 — 스폰을 `WorkerSpawner` 전용 큐로 이동, `spawning` 상태 도입, 스폰 예산 30초.
- **테스트 방안**: 스폰 체인에 120초 지연을 주입하는 시간 가상화 테스트에서 JobCreate ACK가 250ms 데드라인 내 반환하는지 검증 (계약서 §3 G4-2, V7).

#### 사고 2 — 워커 모델 라우팅이 `exploration_model`로 새서 403 사망

- **현상**: 워커가 현재 자격증명으로 인가되지 않은 exploration 모델로 라우팅되어 요청이 403으로 사망.
- **경로 재구성**: `configureSubagentChild` (`subagent-child-config.ts:145`) → `resolveSubagentModelAlias` (`utils/cheap-model.ts:156-184`):
  ```ts
  return (
    pickIfHealthy(explorationModel) ??            // ← loopControl.explorationModel이 1순위
    pickIfHealthy(inferCheapModelAliasSync(...)) ??
    parentModelAlias
  );
  ```
  `isExploreSubagentProfile`은 프로파일 이름에 `explore`가 포함되면 무조건 해당 (`cheap-model.ts:191-198`). Job 워커에서 `profileForJobKind('explore')` → `explore` 프로파일 → exploration 모델 라우팅. `isAliasHealthy`는 자격증명 존재만 보고 **모델 인가(403)는 보지 못함**.
- **근본 원인**: ① "explore 계열 = 저렴한 exploration 모델" 암묵 폴백이 Job 워커까지 오염, ② 헬스 체크가 403(인가 없음)을 사전에 걸러내지 못함.
- **차단 방법 (v2)**: 계약서 §3 — Job 워커는 명시 모델 슬롯(`models.fast` 또는 Job 지정 모델)만 사용. `explorationModel` 폴백 제거. 403을 영구 실패 신호로 분류해 동일 alias 재라우팅 차단.
- **테스트 방안**: `resolveSubagentModelAlias` 단위 테스트 — (a) explore 프로파일+인가 없는 explorationModel → 부모 모델 또는 models.fast로 폴백, (b) 403 시뮬레이션 시 해당 alias가 unhealthy 마킹되는지 검증 (V7).

### A-1~A-14. 경로별 상세

심각도: **P0**(입력 완전 차단) / **P1**(턴 장기 점유) / **P2**(간접·소프트 블로킹)

#### A-1 — TUI 입력 큐잉 (턴 점유 중 입력 정체) · P0
- **파일/함수**: `apps/liora/src/tui/controllers/transcript/message-dispatch.ts` — `sendMessage`(L273-284), `enqueueMessage`. `streamingPhase !== 'idle'` 또는 `isCompacting`이면 입력이 `queuedMessages`로 밀림. 드레인은 턴 종료 후.
- **차단 방법**: 메인 루프를 분류기 루프로 교체(계약서 §7). 턴 점유 개념 자체가 사라지므로 큐잉 경로 소멸. 큐는 사용자 명시적 스택(보류 지시) 용도로만 축소.
- **테스트 방안**: 워커 실행 중 사용자 입력 → ACK 렌더까지 p95 ≤ 1초 계측 테스트 (V3). 현 큐잉 동작은 캐릭터라이제이션으로 고정 후 삭제.

#### A-2 — JobCreate의 스케줄 동기 대기 · P0
- **파일/함수**: `packages/agent-core/src/tools/builtin/job/job-tools.ts:196` — `JobCreateTool.run`이 `await scheduleQueuedJobs(...)`. 이 호출이 worktree 생성(A-3의 assignJobWorktree) + 워커 론칭(A-3)을 같은 턴에서 대기. ACK는 그 뒤에야 반환.
- **차단 방법**: 계약서 §3 G1 — 도구는 원장 upsert + ACK만. 스케줄 펌프는 `ConductorScheduler`(이벤트 구동, 턴 밖)로 이동.
- **테스트 방안**: scheduleQueuedJobs에 지연 주입 시 ACK 데드라인(250ms) 준수 테스트.

#### A-3 — 스폰 await 체인 (worktree 생성 포함) · P0
- **파일/함수**:
  - `job-runtime.ts:177` `scheduleQueuedJobs` → `assignJobWorktree` (`git worktree add` — 대형 레포 수초)
  - `job-worker.ts:140` `launchJobWorker` → `await spawn(...)`
  - `subagent-host.ts:151-213` `spawn` 내부: `ensureAgentResumed` → `assertContractCompiles`(외부 컴파일) → `createAgent`(AGENTS.md/프롬프트 파일 I/O)
- **차단 방법**: 계약서 §3 G2 — worktree 준비와 스폰을 전부 WorkerSpawner 큐로 이동. 메인 경로가 await하는 것은 큐 인큐브(ms 단위)뿐.
- **테스트 방안**: 각 await 지점에 지연 주입(시간 가상화) + ACK/론칭 반환 시간 단언. 125초 사고 재현 시나리오(V7).

#### A-4 — Agent 도구 포그라운드 대기 · P1
- **파일/함수**: `packages/agent-core/src/tools/builtin/fleet/agent.ts` — `execution` L295-306: `waitForForegroundRelease(taskId)` → 자식 완료까지 대기 후 `formatForegroundResult`. `run_in_background=false`가 기본 권장(스키마 L94 "Prefer false").
- **차단 방법**: conductor 프로필에서 Agent 도구 제거(계약서 §2 b-1). 워커 프로필에서는 유지하되, 메인 경로 노출 0건. 잔재 포그라운드 호출은 G3 트리프와이어로 15초 차단.
- **테스트 방안**: conductor 도구 목록 스냅샷(Agent 부재) + 메인에서 Agent 호출 시 거부 테스트.

#### A-5 — UltraSwarm 도구 전체 실행 턴 점유 · P1
- **파일/함수**: `packages/agent-core/src/tools/builtin/fleet/ultra-swarm.ts:132` — `await this.runUltraSwarm(...)`이 전문가 계획 구축(L197) + 풀 컴팩션(L244) + 페이즈 루프 전체(L293) + 원장 기록(L375)을 한 도구 호출 안에서 대기. 수 분~수십 분 점유 가능.
- **차단 방법**: 폐기 대상(인벤토리 B-2). 폐기 전까지는 G3 트리프와이어가 유일한 방어. 대체 경로는 Job fan-out.
- **테스트 방안**: 폐기 전 캐릭터라이제이션(도구 입출력 고정) → 삭제 후 grep 0건.

#### A-6 — AgentSwarm 배치 대기 · P1
- **파일/함수**: `packages/agent-core/src/tools/builtin/fleet/agent-swarm.ts` (380줄) → `host.runQueued` (`subagent-host.ts:281`) → `SubagentBatch.run()` — 배치 전체 완료를 도구 호출에서 대기.
- **차단 방법**: 폐기 대상(인벤토리 B-3). 대체: `JobCreate auto_split` + 스케줄러 병렬 론칭.
- **테스트 방안**: A-5와 동일(캐릭터라이제이션 → 삭제).

#### A-7 — TaskOutput 블로킹 대기 · P1
- **파일/함수**: `packages/agent-core/src/tools/background/task-output.ts:191-197` — `block=true` 시 `waitAll`/`waitAny`/`wait`, 기본 타임아웃 30초. 메인 턴에서 호출되면 최대 30초 점유.
- **차단 방법**: conductor에서는 TaskOutput 자체를 제거(완성은 인박스 이벤트로 도착). 워커에서는 유지하되 G3 예산(15초) 적용 — 30초 기본을 예산 내로 조정.
- **테스트 방안**: conductor 도구 목록 스냅샷 + TaskOutput 예산 캡 테스트.

#### A-8 — orchestratorMode SpawnWorker/MergeWorker · P1
- **파일/함수**: `packages/agent-core/src/tools/builtin/fleet/orchestrator.ts` (520줄) — `SpawnWorkerTool.execution`이 worktree 생성 + 스폰을 도구 안에서 await; `MergeWorkerTool`은 메인 워크스페이스에서 git 머지를 직접 실행. `agent/orchestrator.ts:46-108`의 완료 콜백은 큐 작업/DAG 의존 워커를 **연쇄 자동 스폰**.
- **차단 방법**: 폐기 대상(인벤토리 B-1). MergeWorker의 역할은 MergeJob(판정) + 랜딩 워커(실행, 계약서 §3 G5)로 대체.
- **테스트 방안**: 캐릭터라이제이션 → Job 경로 대체 증명 → 삭제.

#### A-9 — MergeJob의 인라인 git 머지 · P1
- **파일/함수**: `job-tools.ts:439` → `landJobToMain` (`job-land.ts`) — 메타 턴 안에서 `git merge --no-edit <branch>` + 성공 시 worktree GC. 대형 레포/충돌 상황에서 턴 장기 점유 + 메인 워크스페이스 직접 변경.
- **차단 방법**: 계약서 §3 G5 — 판정과 실행 분리. 머지 실행은 전용 랜딩 워커로.
- **테스트 방안**: MergeJob 도구 실행이 원장 판정만 하고 반환하는 계약 테스트(머지 지연 주입).

#### A-10 — JobResume의 스케줄 동기 대기 · P1
- **파일/함수**: `job-worker.ts:400` `resumeJobs` → `await scheduleQueuedJobs(...)` — resume 도구 호출이 다시 worktree/스폰 체인을 턴에서 대기 (A-2/A-3의 재진입).
- **차단 방법**: A-2와 동일한 치료 — resume은 `queued` 전이 + ACK만, 펌프가 나머지를 처리.
- **테스트 방안**: resumeJobs 반환 시간 단언(스폰 지연 주입).

#### A-11 — 세션 로딩 오버레이 입력 차단 · P2
- **파일/함수**: `message-dispatch.ts:112` — `isReplaying || isSessionLoadingOverlayActive()`면 입력 자체가 거부(`showError busy`). 세션 재개/리플레이 중 모든 입력 드롭.
- **차단 방법**: v2 범위에서는 로드 중 입력을 원장 접수만 하고 분류를 보류(입력 드롭 0건 원칙). 로딩 오버레이의 입력 거부는 유지하되 저장 후 처리.
- **테스트 방안**: 로딩 중 입력 → 큐 보존 → 로드 완료 후 분류 테스트.

#### A-12 — 알림 폭풍의 메인 턴 반복 점유 · P2
- **파일/함수**: `packages/agent-core/src/agent/injection/job-desk.ts` — `JobDeskInjector`가 턴마다 미읽 인박스를 주입(≤5건/1.5KB). 주입 자체는 가볍지만, 완료가 폭주하면 메인이 알림에 반응하는 **턴 수**가 늘어난다.
- **차단 방법**: 계약서 §4 — 폭주 임계(5분 내 ≥5건) 초과 시 desk 워커 digest. 메인 턴 증가는 에스컬레이션 카드 1건분으로 캡.
- **테스트 방안**: 완료 10건 동시 주입 시 메인 턴 수/주입 바이트 캡 테스트.

#### A-13 — conductor의 Bash 포그라운드 · P0 (잠재)
- **파일/함수**: `profile/default/conductor.yaml` — Bash 노출. 메인이 `pnpm test`류 장기 명령을 포그라운드로 돌리면 턴 무제한 점유. 현재 억제 수단은 프롬프트 문장뿐.
- **차단 방법**: 계약서 §2 — Bash 제거 또는 읽기 전용 정책 + G3 벽시계 트리프와이어(15초 하드 캡).
- **테스트 방안**: conductor에서 쓰기/장기 Bash 거부 테스트 + 15초 캡 계측.

#### A-14 — 웜풀 프리스폰의 시작 자원 경쟁 · P2
- **파일/함수**: `tools/builtin/job/job-warm-pool.ts` — `ensureWarmPool`이 spawner 콜백으로 백그라운드 스폰 발사(fire-and-forget). 메인 턴을 await으로 막지는 않지만, 세션 시작 직후 A-3 체인 N개를 동시 촉발해 CPU/I/O를 점유.
- **차단 방법**: G2 스폰 큐로 흡수(순차 + 예산). 웜풀 크레딧은 스폰 성공 후에만 반영.
- **테스트 방안**: 웜풀 2슬롯 동시 스폰 시 메인 입력 ACK 지연 무영향 계측.

### A장 소결

| 심각도 | 건수 | 항목 |
|---|---|---|
| P0 (입력 완전 차단) | 4 | A-1, A-2, A-3, A-13 |
| P1 (턴 장기 점유) | 7 | A-4, A-5, A-6, A-7, A-8, A-9, A-10 |
| P2 (간접/소프트) | 3 | A-11, A-12, A-14 |

공통 치료 4종: G1 ACK 데드라인, G2 스폰 격리, G3 벽시계 트리프와이어, G4 await-zero 증명 (계약서 §3).

## B. 레거시/중복 인벤토리

### B-1~B-8. 폐기 후보군 상세

판정 용어: **DELETE** = 완전 삭제 / **MERGE** = 단일 경로로 통합 / **KEEP** = 유지.

#### B-1 — orchestratorMode 스택 (SpawnWorker 계열) · DELETE
- **구성**: `agent/index.ts` (`orchestratorMode` 플래그, L167-379), `agent/orchestrator.ts` (109줄, 도구 등록 + 완료 콜백 연쇄 스폰), `tools/builtin/fleet/orchestrator.ts` (520줄 — SpawnWorker/SteerWorker/QueryWorker/EnqueueWorkerTask/MergeWorker), 참조: `agent/rpc-methods.ts:150`, `agent/agent-status-updated.ts:89`.
- **현재 사용처**: `orchestratorMode=true`로 기동한 세션. Conductor 기본 경로(Job*)와 기능이 1:1 중복(스폰/스티어/조회/큐/머지 전부 Job 도구로 대체 가능).
- **판정**: DELETE. 근거: ① Job 원장이 동일 기능의 검증된 SSOT, ② SpawnWorker는 브리지(B-5)를 거쳐도 결국 별도 워커 레지스트리(`OrchestratorWorker` Map)를 유지 — 원장 2개 문제, ③ 오늘의 125초 사고 경로 중 하나.
- **폐기 순서**: ① conductor 가드에서 orchestratorMode 진입 차단(플래그 무시) → ② 캐릭터라이제이션 테스트 → ③ 도구 5종 삭제 → ④ 플래그/콜백/RPC 필드 삭제.
- **가드레일**: SpawnWorker 동작(스폰+worktree+완료 보고)을 JobCreate로 재현하는 대체 증명 테스트.
- **예상 diff**: 약 700줄 삭제 + TUI 상태 표면(agent-status-updated 필드) 정리.

#### B-2 — UltraSwarm 모듈군 (합의/토론/리스태프) · DELETE (Mission 결합은 단계 분리)
- **구성**:
  - `session/ultra-swarm-*.ts` 5파일 1,007줄 (consensus/critic/debate/debate-cycle/restaff)
  - `tools/builtin/fleet/ultra-swarm*.ts` 13파일 3,767줄 (도구 본체 + phase-loop + schema + prompt + render + restaff + budget-debate 등)
  - `agent/ultra-swarm-run.ts` (129줄) + `expert-agents/*` 결합 + `fleet/swarm-bus-coordination.ts`
  - **Mission 결합**: `mission/recovery-injectors.ts`(6곳), `mission/mirror-reconcile.ts`, `mission/recovery-resume.ts`, `mission/auto-activate-llm.ts` + journal `UltraworkRunMirror` (schema 1→2 이중 읽기)
  - 참조 규모: agent-core 97개 파일에서 ultra-swarm/UltraSwarm 언급.
- **현재 사용처**: `UltraSwarm` 도구 호출(전문가 팀 합의 코딩), Mission 회복 경로 일부.
- **판정**: DELETE. 근거: ① 단일 도구 호출이 턴 전체를 점유(A-5) — 불변 조건 2 정면 위반, ② "전문가 합의"는 프롬프트 시어터에 가깝고 독립 검증이 없음, ③ 병렬 실행은 Job fan-out이 대체. 단, **expert 카탈로그 자체는 KEEP** (워커 프로파일 프리셋으로 유용).
- **폐기 순서**: ① Mission 회복 경로의 ultraSwarmRun 참조를 Job 원장 참조로 교체(캐릭터라이제이션先行) → ② UltraSwarm 도구 비노출(프로파일 제거) → ③ phase-loop/schema/prompt 삭제 → ④ session ultra-swarm-* 삭제 → ⑤ journal mirror는 구 스키마 읽기 전용 보존(리플레이 호환).
- **가드레일**: Mission 회복 시나리오 테스트 3종(중단→재개, needs_user, 완료)이 UltraSwarm 없이 그린.
- **예상 diff**: 약 8,000~10,000줄 삭제(참조 정리 포함, 단일 최대 폐기 군).

#### B-3 — AgentSwarm 템플릿 + war-room TUI · DELETE
- **구성**: `tools/builtin/fleet/agent-swarm.ts` (380줄) + `swarm-channel.ts`/`swarm-research-autonomy.ts` (합계 639줄 중 해당 분), TUI `features/agent-swarm/*` 21파일 3,556줄 (braille/feed/grid/war-room 렌더).
- **현재 사용처**: `AgentSwarm` 도구(템플릿 스웜), TUI war-room 뷰.
- **판정**: DELETE. 근거: ① 배치 대기 블로킹(A-6), ② 멀티 태스크는 `JobCreate auto_split` + 스케줄러가 검증된 경로로 대체, ③ war-room UI는 컨트롤 타워(B장의 S2 스트림)가 전용 설계로 대체 — 재활용하지 않음(계약서 §5.4).
- **폐기 순서**: 컨트롤 타워 S2 착수 확인 → AgentSwarm 도구 비노출 → TUI features/agent-swarm 삭제 → 도구 본체 삭제.
- **가드레일**: fan-out 5태스크 → 5 Job 대체 증명 테스트 (v1 A3 테스트 계승).
- **예상 diff**: 약 4,500줄 삭제.

#### B-4 — fleet swarm-* 서포트 모듈 · 판정 혼합
- **구성** (`packages/agent-core/src/fleet/`, 합계 2,357줄):

| 모듈 | 줄 | 판정 | 근거 |
|---|---|---|---|
| `swarm-file-lease.ts` | 262 | KEEP | Job 스폰의 ownership 충돌 검사에 실사용 (`claimChildOwnership`) |
| `swarm-evidence-gate.ts` | 292 | KEEP | 워커 검증 게이트로 재사용 가능 |
| `swarm-dag-scheduler.ts` | 189 | REBUILD | Job 의존성(dependsOn) 스케줄러로 재설계 |
| `swarm-run-ledger.ts` | 240 | REBUILD | Job 이벤트/저널로 흡수 (UltraSwarm 전용 필드 제거) |
| `swarm-budget.ts` / `swarm-cost-guard.ts` | 207/182 | REBUILD | 풀 백프레셔/비용 가시성으로 통합 |
| `swarm-bus-coordination.ts` | 343 | DELETE | UltraSwarm 전용 메시지 버스 — B-2와 동반 삭제 |
| `swarm-humanize.ts` | 294 | DELETE | UltraSwarm 렌더링 보조 |
| `swarm-maker-checker.ts` | 348 | DELETE | UltraSwarm 검토 절차 — 대체 없음(불필요) |

- **폐기 순서**: B-2 삭제와 동기(bus/humanize/maker-checker) → REBUILD 4종은 S1 스트림에서 Job 런타임에 흡수.
- **가드레일**: file-lease/기존 사용처 테스트 유지; REBUILD 모듈은 흡수 후 구 모듈 grep 0건.
- **예상 diff**: DELETE 약 985줄, REBUILD 이동 약 1,021줄.

#### B-5 — SpawnWorker 브리지 · DELETE
- **구성**: `tools/builtin/job/job-fleet-bridge.ts` (43줄 — `registerSpawnWorkerAsJob`, `fleetBridgeNotice`) + SpawnWorkerTool의 toolStore 배선.
- **현재 사용처**: orchestratorMode SpawnWorker 호출 시 Job 원장에 흔적만 등록. 실제 실행은 여전히 B-1 스택.
- **판정**: DELETE. 근거: B-1 삭제 후 브리지가 받을 호출이 사라짐. "호환"을 위해 남기면 이중 경로가 다시 자란다.
- **폐기 순서**: B-1 완료 직후 삭제.
- **가드레일**: 브리지 경유 시나리오가 JobCreate 직접 경로 테스트로 커버되는지 확인.
- **예상 diff**: 약 60줄 삭제.

#### B-6 — 중복 태스크 레지스트리 4종 · MERGE (Job 원장으로 단일화)
- **구성**: ① Job 원장(`job-ledger.ts` — SSOT로 KEEP), ② BackgroundManager(`agent/background/*` 19파일 약 1,867줄 — 프로세스/태스크 인프라로 KEEP), ③ `OrchestratorWorker` Map (B-1 소속), ④ UltraSwarm run ledger (B-2/B-4 소속).
- **현재 사용처**: 에이전트/도구가 자기 편한 레지스트리에 상태를 기록 — "워커 몇 개 도나" 질문의 답이 경로마다 다름.
- **판정**: MERGE. 상태 진실은 Job 원장 1개. BackgroundManager는 원장 아래의 **프로세스 실행 프리미티브**(Bash 백그라운드, detach 태스크)로 남고, ③④는 삭제(B-1/B-2에 포함). TUI는 원장+`job.*` 이벤트만 구독.
- **폐기 순서**: B-1, B-2 진행과 동일. 남는 작업은 TUI 구독 단일화(S2 스트림).
- **가드레일**: "활성 워커 목록" 조회가 단일 원장 경로로만 응답하는 계약 테스트.
- **예상 diff**: 레지스트리 자체 삭제는 B-1/B-2에 포함; 배선 정리 약 200줄.

#### B-7 — TUI 레거시 오케스트레이션 서피스 · DELETE
- **구성**: `commands/ultrawork/*` + `commands/swarm/*` (합계 2,241줄), `controllers/session-event/ultrawork.ts`, `/mission` 외 ultra 계열 슬래시, `features/agent-swarm` (B-3에 포함).
- **현재 사용처**: UltraSwarm/AgentSwarm의 사용자 진입점. 백엔드(B-2/B-3) 삭제 시 고아.
- **판정**: DELETE. `/jobs`·`/job`은 컨트롤 타워 보조 수단으로 유지(계약서 §5.3), `/mission`은 Mission-as-Job 진입으로 유지.
- **폐기 순서**: 백엔드 삭제 PR과 같은 PR 시리즈에서 커맨드 동시 삭제(고아 커맨드 잔존 금지).
- **가드레일**: 슬래시 커맨드 목록 스냅샷 테스트 갱신.
- **예상 diff**: 약 2,400줄 삭제.

#### B-8 — collaboration 심 디렉터리 · DELETE
- **구성**: `tools/builtin/collaboration/*` — 24개 파일 전부 fleet/으로의 1줄 re-export 심 (`agent-swarm.ts`, `ultra-swarm*.ts`, `orchestrator.ts` 등).
- **현재 사용처**: 이전 이동(migration) 잔재. `fleet/AGENTS.md`가 "compatibility shim"으로 명시.
- **판정**: DELETE. 근거: 소비자가 fleet 경로를 직접 import 하도록 정리된 후 심 자체 제거.
- **폐기 순서**: ① `#/collaboration`·`collaboration/` import 전수 조사 → fleet 경로로 이관 → ② 심 삭제. `src/collaboration/index.ts` 동반 삭제.
- **가드레일**: `check:imports` + 심 이름 import grep 0건.
- **예상 diff**: 약 50줄 삭제 + import 치환.

### B장 소결

| 판정 | 군 | 합산 규모(추정) |
|---|---|---|
| DELETE | B-1, B-2, B-3, B-5, B-7, B-8 + B-4 일부(bus/humanize/maker-checker) | 약 16,000~18,000줄 |
| REBUILD | B-4 일부(dag/ledger/budget/cost), B-6 배선 | 약 1,200줄 재배치 |
| KEEP | Job 원장, 보안 가드, file-lease, evidence-gate, BackgroundManager(프리미티브), expert 카탈로그 | — |

## C. 폐기 순서와 테스트 가드레일

### C.1 전제 규칙 (계약서 §6 재확인)

1. 가드 먼저 → 대체 경로 둘째 → 삭제 마지막.
2. 삭제 PR 4종 가드레일: 캐릭터라이제이션 테스트 / 대체 경로 증명 / 참조 0건 / 베이스라인 래칫.
3. 고아 잔재 금지: 백엔드 삭제와 TUI 진입점을 같은 PR 시리즈에서 제거.

### C.2 단계 순서

| 단계 | 내용 | 선행 조건 | 게이트 |
|---|---|---|---|
| R0 | 가드 코어(S0): conductor 도구 화이트리스트, 직접 작업 가드, 벽시계 트리프와이어, orchestratorMode 진입 차단 | 없음 | 계약서 V1 |
| R1 | Job 런타임 v2(S1): ACK 데드라인, 스폰 큐, 모델 슬롯, 머지 오프로딩 | R0 (도구 예산) | 계약서 V2, V7 |
| R2 | B-8(collaboration 심) 제거 — 위험 최저, import 정리 연습 | R0 | grep 0건 |
| R3 | B-1(orchestratorMode) + B-5(브리지) 제거 | R1 (Job 경로가 완전 대체) | 대체 증명 테스트 |
| R4 | B-2(UltraSwarm) 제거 — Mission 결합 분리 포함, 최장 트랙 | R1 | Mission 회복 테스트 3종 |
| R5 | B-3(AgentSwarm) + B-7(TUI 서피스) 제거 | 컨트롤 타워 S2 착수 | 팬아웃 대체 증명 |
| R6 | B-4 잔여(bus/humanize/maker-checker) + B-6 레지스트리 단일화 | R3, R4 | 단일 원장 계약 테스트 |
| R7 | 최종 스윕: ultra* 심볼 grep, `orchestratorMode` grep, journal 구 스키마 읽기 전용 확인 | R2~R6 | V6 |

R3~R5는 서로 파일 영역이 겹치지 않아 병렬 PR 가능. R4가 임계 경로(Mission 결합).

### C.3 테스트 가드레일 현황 (오늘 기준으로 존재하는 것)

| 테스트 | 위치 | 보호 대상 |
|---|---|---|
| job-ledger.test.ts (20) | `packages/agent-core/test/tools/` | Job 원장/상태 머신 — KEEP 자산의 핵심 가드 |
| default-agent-profiles.test.ts (21), main-profile.test.ts (7) | `test/profile/` | 프로파일 도구 목록 — v2에서 conductor 화이트리스트 스냅샷으로 강화 |
| bash.test.ts / bash-env.test.ts | `test/tools/` | 워커 push 금지/보안 가드 |
| job-events.test.ts (2) | `packages/protocol/src/__tests__/` | job.* 이벤트 호환 |
| job-strip.test.ts (3) | `apps/liora/test/tui/utils/` | TUI 스트립 — 컨트롤 타워 전환 시 폐기/교체 대상 |

**추가 필요 (삭제 전 의무)**: orchestrator 도구 5종 캐릭터라이제이션, UltraSwarm 도구 입출력 캐릭터라이제이션, AgentSwarm 배치 결과 캐릭터라이제이션, Mission-스웜 분리 회복 시나리오, TUI 슬래시 목록 스냅샷.

## D. 집계 요약

| 지표 | 수치 |
|---|---|
| 블로킹 경로 (A장) | **14건** (P0 4 / P1 7 / P2 3) + 오늘 사고 2건(A-0) |
| 폐기 후보 군 (B장) | **8개 군** (B-1~B-8) |
| DELETE 판정 | 6개 군 전체 + B-4 모듈 3종 + B-6 레지스트리 2종 |
| REBUILD 판정 | B-4 모듈 4종(dag/ledger/budget/cost) + B-6 배선 + Job 런타임(스케줄/스폰/모델) |
| KEEP 판정 | Job 원장·프로토콜·격리·보안·resume·머지 신뢰 규칙·file-lease·evidence-gate·BackgroundManager·expert 카탈로그 |
| 예상 삭제 규모 | 약 16,000~18,000줄 (agent-core + TUI 합산) |
| v2 가드 | G1 ACK 데드라인, G2 스폰 격리, G3 벽시계 트리프와이어, G4 await-zero 증명, G5 머지 오프로딩 |
| 임계 경로 | R4 (UltraSwarm 제거의 Mission 결합 분리) |

### 남은 리스크 (조사 한계 포함)

1. **Mission-UltraSwarm 결합의 실제 깊이**: recovery/mirror 경로에서 ultraSwarmRun 참조 10+곳 확인했으나, 저널 리플레이 호환 범위는 R4 착수 시 실측 필요.
2. **`SUPERLIORA_CONDUCTOR_MAX_CONCURRENT` 등 환경 변수 계약**: 풀 설정 환경 변수가 v2에서도 그대로인지 사용자 확인 필요(계약서에서는 기본값만 고정).
3. **플러그인/MCP 도구 우회**: §2 가드의 보수 판정이 플러그인 도구의 읽기 전용 유틸까지 과도하게 막을 수 있음 — 화이트리스트 등재 절차 필요.
4. **server 패키지(`packages/server`) 경유 세션**: REST/WS로 구동되는 세션도 동일한 메인 루프 재설계 대상인지(TUI 외 서피스)는 Phase 1 착수 전 범위 결정 필요.
5. 줄 수 추정은 현재 HEAD 기준이며, 삭제 과정에서 참조 정리가 늘면 ±20% 변동 가능.
