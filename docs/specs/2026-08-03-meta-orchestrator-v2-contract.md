# Meta Orchestrator v2 — 하드 계약서 (Hard Contract)

작성일: 2026-08-03
상태: Phase 0 산출물 (계약 초안 — 구현 스트림 착수 전 잠금 대상)
선행 문서: `docs/specs/2026-08-03-meta-orchestrator-conductor.md` (v1 진행 노트), `-goal-plan.md`, `-evidence.md`
짝꿍 산출물: `docs/specs/2026-08-03-blocking-and-legacy-inventory.md`

> 이 문서는 SuperLiora 메타 오케스트레이터 전면 재구성 프로그램의 **목표 아키텍처 하드 계약**이다.
> 아래 불변 조건 1~5는 협상 대상이 아니다. 각 조건의 위반은 릴리스 게이트 실패를 의미한다.
> v1(Conductor P0~P5)에 붙이는 증분 설계는 금지된다. 메인 루프 모델과 TUI는 새로 정의한다.

---

## 1. v1(Conductor P0~P5) 비판적 평가

원칙: **증명된 것만 유지한다.** v1 증거 팩(`2026-08-03-conductor-evidence.md`)의 ✅는 대부분 단위 테스트 수준의 증명이며, 제품 루프 수준(실제 TTY + LLM + 병렬 워커)에서 증명된 것은 거의 없다. G2 데모조차 "코드 레벨 테스트가 증거"이며 라이브 데모는 없었다.

### 1.1 유지 (증명된 자산)

| 자산 | 근거 | v2에서의 위치 |
|---|---|---|
| Job 원장 데이터 모델 + 상태 머신 (`queued/running/blocked/needs_user/done/failed/cancelled/interrupted`) | `job-ledger.ts` + `job-ledger.test.ts` (20 케이스) | v2 단일 SSOT 원장으로 승격 |
| `job.updated` / `job.inbox` 프로토콜 이벤트 (schemaVersion 1, unknown-ignore) | `protocol/src/events/job.ts` + 테스트 2건 | 스키마 v2로 확장하되 호환 원칙 유지 |
| always-worktree 격리 + 실패 시 `blocked` (조용한 공유 cwd 없음) | `job-runtime.ts assignJobWorktree` | 그대로 유지 |
| 워커 `git push` 금지 + 시크릿 hard-block 상속 + worktree 루트 가드 | `job-worker-guards.ts`, BashTool `isWorker` | 그대로 유지 |
| interrupted → 원클릭 resume 의미론 | `resumeJobs` + `/job resume` | 그대로 유지 |
| MergeJob 신뢰 규칙 (small ∧ no-conflict ∧ checks-green ∧ non-dangerous) | `job-merge-trust.ts` | 유지하되 실행은 전용 랜딩 워커로 이동 (§3 G5) |

### 1.2 재설계 전제 (증명되지 않았거나 깨진 주장)

| v1 주장 | 반증 / 현실 | 결론 |
|---|---|---|
| "ACK p50 ≤ 2s" (A2 ✅) | `JobCreateTool`이 같은 턴에서 `await scheduleQueuedJobs` → `assignJobWorktree`(git worktree add) → `launchJobWorker` → **`await spawn(...)`** 을 실행한다 (`job-tools.ts:196`, `job-worker.ts:140`). ACK는 스폰 체인이 끝난 뒤에야 반환된다. 오늘의 125초 스폰 블로킹 사고가 이 경로를 그대로 맞혔다. | ACK 경로를 원장 기록과 분리한다 (§3 G1) |
| "worker spawn은 fire-and-forget" (B4 ✅) | `void handle.completion`만 fire-and-forget일 뿐, **스폰 자체는 await** 된다. `host.spawn()`은 `ensureAgentResumed` → `assertContractCompiles`(외부 컴파일 검사) → `createAgent`(시스템 프롬프트/AGENTS.md 파일 I/O)를 순차 대기한다 (`subagent-host.ts:151-213`). | 스폰을 전용 비대기 큐로 이동 (§3 G2) |
| "Conductor는 delegation-only" | `conductor.yaml`이 Write/Edit/ApplyPatch/Bash/RunProjectChecks + `Agent` + `Fleet` 도구를 그대로 노출한다. 억제는 프롬프트 문장("small Q&A ... may be done directly")뿐, 런타임 강제 0건. | 도구 화이트리스트 + 런타임 가드 (§2) |
| "논블로킹 인터랙티브 레인" (A1 ✅) | `classifyConductorLane`은 **휴리스틱 조언**이고 하드 게이트가 아니라고 주석에 명시돼 있다 (`job-lanes.ts:24`). TUI는 메인 턴이 도는 동안(`streamingPhase !== 'idle'`) 사용자 입력을 큐로 밀어낸다 (`message-dispatch.ts:273-284`). 턴 자체가 길면 입력은 막힌다. | 턴 예산 자체를 재정의 (§7) |
| "Fleet 단일 엔진" (D1–D3 ✅) | 실상은 `Job*` 경로 위에 `SpawnWorker` 브리지(원장 등록만)를 얹은 것. `orchestratorMode` 스택(SpawnWorker/Steer/Query/Enqueue/MergeWorker), UltraSwarm, AgentSwarm이 그대로 공존한다. 엔진 4개. | 병렬 스택 폐기 (§6, 인벤토리 B장) |
| "TUI 컨트롤 타워" (E1–E3 ✅) | 구현은 트랜스크립트 화면 + 푸터 스트립 + 토스트 + `/job inspect` 드릴다운. 관제 화면이 아니라 코더 트랜스크립트에 붙인 장식이다. | 전용 컨트롤 타워로 재설계 (§5) |
| "워커 모델 라우팅" | explore 계열 프로파일은 `loopControl.explorationModel`을 1순위로 picks (`cheap-model.ts resolveSubagentModelAlias`). 오늘의 403 사망 사고: 워커가 현재 자격증명으로 인가되지 않은 exploration 모델로 라우팅됨. | Job 전용 모델 슬롯 + 인가 검증 (§3, 인벤토리 A-0) |

### 1.3 판정 집계

- 유지: 6개 자산 (원장/프로토콜/격리/보안/resume/머지 신뢰 규칙)
- 재설계: 7개 전제 (ACK, 스폰, delegation, 논블로킹, 단일 엔진, TUI, 모델 라우팅)
- 폐기: 8개 레거시 군 (인벤토리 B장 — orchestratorMode, UltraSwarm, AgentSwarm, fleet swarm-* 일부, SpawnWorker 브리지, 중복 태스크 레지스트리, TUI 스웜/울트라워크 서피스, collaboration 심)


## 2. 불변 조건 1 — delegation-only conductor (메인은 위임만 한다)

### 2.1 정의

메인 에이전트(Conductor)가 턴 안에서 직접 수행해도 되는 작업의 **완전 열거**:

1. 입력 분류 (§7)
2. Job 원장 조작: `JobCreate / JobList / JobInspect / JobSteer / JobCancel / JobResume / JobInbox / MergeJob`(신뢰 판정만)
3. 상태 조회(원장 읽기, 워커 이벤트 요약 읽기)와 단순 응답(인사, 상태 설명, 계획 요약)
4. 사용자 clarification: `AskUserQuestion` (needs_user 카드 응답 포함)
5. 플랜/골 생명주기 **관리**: `EnterPlanMode / NextPhase / ExitPlanMode / RecordInterviewFinding / CreateGoal / GetGoal / UpdateGoal` (단계 진행 판정이지 코딩이 아님)
6. `Skill / SearchSkill` (위임 준비를 위한 절차 조회)

**절대 금지**(런타임이 거부해야 함):
- 파일 생성/수정 도구: `Write`, `Edit`, `ApplyPatch`
- 장기 셸 작업: 빌드, 테스트, 설치, 마이그레이션 등 **쓰기 또는 5초 초과** Bash
- 서브에이전트 결과를 기다리는 포그라운드 스폰 (기존 `Agent` 포그라운드, `Fleet` SpawnWorker 직접 호출)
- 어떤 형태의 "내가 잠깐만 고치고" 경로 — 1~2스텝 편집 포함. v1의 "trivial fast path는 메인이 직접" 예외는 **폐기**한다. 예외가 존재하는 한 모델은 예외를 남용하고, 블로킹은 그 예외에서 발생한다 (오늘 사고가 정확히 이 경로).

판정 규칙: **파일을 바꾸거나 검증 루프를 돌리는 일은 전부 Job** 이다. 메인에게는 읽기 전용 조회만 남는다.

### 2.2 강제 메커니즘 (b)

**(b-1) 프로파일 도구 화이트리스트.** `conductor.yaml`에서 Write/Edit/ApplyPatch/RunProjectChecks 제거. Bash는 제거가 원칙이나, 상태 조회용 `git status/log/diff`류가 필요하면 **읽기 전용 정책**(`tool-read-only.ts` 계열)으로 고정하고 쓰기 명령은 hard-deny. `Agent`/`Fleet` 도구 제거 — 위임 수단은 `Job*` 도구가 유일하다.

**(b-2) 런타임 가드 `ConductorDirectWorkGuard`.** 프롬프트 우회(플러그인 도구, MCP, 새 내장 도구)를 막는 2차 방어선. 위치는 `loop/tool-call-execute.ts` 직전(가드 훅):

- 대상: `agent.type === 'main'` && 프로필이 delegation-only 클래스(`conductor`)인 턴.
- 판정: 도구가 선언하는 `ToolAccesses`에 write/execute-large 가 포함되면 거부. 내장 도구는 정적 태그, 서드파티 도구는 기본 보수 판정(write로 간주).
- 위반 시 실패 모드: 도구 실행 **전**에 `isError: true` 결과 반환. 본문은 고정 라우팅 문구:
  `"Direct work is not allowed on the Conductor lane. This became a Job draft — call JobCreate to delegate (suggested title/prompt attached)."`
  + 제안 Job 초안(title/prompt/ownership)을 결과에 동봉해, 모델이 "거부 → 재시도"가 아니라 "거부 → 위임"으로 흐르게 한다.
- 자동 라우팅(선택 2단계): 같은 턴에서 2회 이상 위반 시 가드가 **직접 원장에 Job 초안을 `queued`로 기록**하고 ACK 텍스트를 반환. 모델이 위임을 배우지 않아도 시스템이 위임을 완료한다.
- 3회 위반: 턴을 강제 종료하고 사용자에게 시스템 메시지("직접 작업 시도 3회 차단 — Job으로 접수됨").

**(b-3) 회귀 테스트.** conductor 프로필 도구 목록 스냅샷 테스트 + "메인이 Write 호출 → 거부 + Job 초안" 계약 테스트를 `test/profile/`, `test/tools/`에 고정. 이 테스트가 깨지는 PR은 병합 불가.

### 2.3 예외 처리

- **위험 작업의 사용자 직접 지시**("이 파일 한 줄만 고쳐"): 여전히 Job. Job은 30초 안에 끝날 수 있고, 오버헤드는 스폰(비대기)이므로 사용자 체감 비용이 없다.
- **비-conductor 메인 프로필**(파워 유저가 `SUPERLIORA_PROFILE=agent`로 내린 경우): 이 계약의 적용 대상이 아니다. delegation-only는 `conductor` 프로필의 정의 자체다.

## 3. 불변 조건 2 — 비동기 위임, 동기 대기 0건

### 3.1 정의

메인 에이전트의 어떤 턴도 워커의 **수명**(스폰 준비, 실행, 완료, 머지)을 `await`하지 않는다. 모든 위임은 원장 기록 + ACK로 즉시 끝나고, 실제 작업은 fire-and-forget 비대기 워커로 넘어간다. "0건"의 증명 책임은 코드 리뷰가 아니라 **런타임 가드 + CI 테스트**가 진다.

현재 위반 지점의 전수 목록은 인벤토리 A장(A-1~A-14)에 있다. 대표적으로:
- `JobCreate` → `await scheduleQueuedJobs` → worktree 생성 + `await spawn` (`job-tools.ts:196`)
- `host.spawn()` 내부의 `ensureAgentResumed` / `assertContractCompiles` / `createAgent` 순차 대기 (`subagent-host.ts:151-213`)
- `Agent` 포그라운드: `waitForForegroundRelease` → 자식 완료 대기 (`fleet/agent.ts:295-306`)

### 3.2 (a) 블로킹 금지 런타임 가드 설계

가드는 "어디서 무엇을 막나 + 위반 시 어떻게 실패하나"를 각각 고정한다.

#### G1 — ACK 데드라인 (위임 경로)

- **어디**: `JobCreateTool.run` 및 모든 원장 변경 도구.
- **무엇을 막나**: 도구 호출이 스케줄/스폰/머지 같은 실행 경로를 `await`하는 것.
- **설계**: 도구 실행은 ① 원장 upsert(동기, 메모리+파일 append) → ② ACK 반환으로 끝난다. 스케줄 펌프는 도구 경로에서 제거하고, 세션 단위 **`ConductorScheduler` 루프**(이벤트 구동, 메인 턴과 무관한 마이크로태스크)가 `queued` 원장을 감시해 승격한다. ACK 데드라인: 도구 시작 → 반환 **p99 ≤ 250ms**(원장 I/O만 허용). 데드라인 초과 시 도구는 이미 기록된 원장 상태로 ACK하고, 초과 원인은 인박스 노티스로 격리 보고.
- **위반 시 실패 모드**: 데드라인 워치독이 초과 호출을 중단시키고 `isError` 없이 ACK(원장 진실은 유지). 펌프가 죽어도 Job은 `queued`로 보임 — 사용자가 `/jobs`에서 "밀림"을 보지, 입력이 막히지는 않는다.

#### G2 — 스폰 격리 (워커 생성 경로)

- **어디**: `SessionSubagentHost.spawn`을 호출하는 모든 Conductor 경로 (`launchJobWorker`, 웜풀).
- **무엇을 막나**: `ensureAgentResumed` + `assertContractCompiles` + `createAgent` 체인이 인터랙티브 턴에서 await되는 것. 오늘의 125초 블로킹이 이 체인에서 발생.
- **설계**: `WorkerSpawner` 전용 큐(프로세스 내 단일 스케줄러 액터). 원장은 `running`이 아니라 **`spawning`** 상태를 새로 갖고, 스폰 큐 인큐브 즉시 ACK한다. 스폰 큐 항목은 ① worktree 준비(이미 G1 밖) ② `spawn` 호출 ③ 성공 시 `running` 전이 + 이벤트, 실패/타임아웃(스폰 자체 예산 **30초**) 시 `blocked`(사유 기록)으로 전이. 스폰 큐 처리는 어떤 사용자 턴의 프로미스 체인에도 연결되지 않는다.
- **위반 시 실패 모드**: 스폰 예산 초과 → 해당 Job `blocked` + 인박스; 큐 자체 정체는 백프레셔 신호로 TUI에 표시. 메인 턴은 항상 자유.

#### G3 — 턴/도구 벽시계 트리프와이어

- **어디**: `loop/tool-call-execute.ts` — 메인(conductor) 에이전트의 모든 도구 호출.
- **무엇을 막나**: 도구 1개가 턴을 점유하는 것. delegation-only 프로필에서 긴 도구는 곧 불변 조건 1 위반의 증거다.
- **설계**: 도구별 벽시계 예산 — 소프트 5초(경고 + 스트림 상태 표시), 하드 15초(호출 중단). Job* 도구와 AskUserQuestion은 예외 없이 동일 예산(이들도 원장 I/O만 하므로 250ms가 정상). 중단된 도구는 `isError: true + "tool exceeded budget — likely direct work; delegate via JobCreate"` 반환.
- **위반 시 실패 모드**: 3회 연속 트리프 → 턴 종료 + 시스템 메시지 + 자동 진단 리포트(인박스).

#### G4 — await-zero 증명 (테스트 게이트)

- **어디**: CI.
- **무엇을 막나**: 회귀. "fire-and-forget" 주석이 깨지는 것.
- **설계**:
  1. 계약 테스트: 가짜 스폰(`spawnOne` 주입)으로 `launchJobWorker`를 호출하고, 반환 시점에 completion 프로미스가 미해결 상태여야 통과(이미 존재하는 계약의 실제 강제화 — 현재 `assertNonBlockingLaunchContract`는 수동 불리언 인자라 실효성이 없음. 이를 런타임 관찰로 대체).
  2. 시간 가상화 테스트: 스폰 체인에 120초 지연을 주입해도 JobCreate ACK가 데드라인 내 반환.
  3. 정적 스캔: `packages/agent-core/src/tools/builtin/job/**`와 conductor 경로에서 `handle.completion` / `spawnAgents` 결과를 `await`하는 패턴을 grep하는 lint 룰(위반 목록은 인벤토리 A장과 1:1 대응).
  4. TUI 계약 테스트: 워커가 도는 동안 사용자 입력이 `enqueue`가 아니라 즉시 분류 경로로 들어가는지 검증 (§7).

#### G5 — 머지/랜드 오프로딩

- **어디**: `MergeJobTool` → `landJobToMain` (`job-tools.ts:439`).
- **무엇을 막나**: 메인이 `git merge`를 자기 턴에서 실행하는 것(대형 레포 머지/체크는 수십 초 + 메인 워크스페이스 위험).
- **설계**: MergeJob은 **판정**(신뢰 규칙 평가 → auto/hold)만 하고, 실제 `git merge --no-edit` + 검증은 전용 랜딩 워커(kind=`merge`)가 worktree→main 순서로 수행. 결과는 인박스로 복귀.

### 3.3 증명 기준

v2 릴리스는 다음이 전부 기계적으로 통과해야 "동기 대기 0건"을 주장할 수 있다:
- G1~G4 테스트 스위트 그린 (agent-core + liora)
- 데모 세션에서 워커 3개 동시 실행 중 메인 턴 벽시계 최대값 ≤ 3초 (계측 로그 증거)
- 정적 스캔 위반 0건

## 4. 불변 조건 3 — 알림/인박스 오프로딩

### 4.1 정의

완료 알림, 인박스 처리, 모니터링 요약조차 메인-사용자 상호작용을 방해하면 안 된다. 방해요소의 정의 = 메인 턴의 예산을 쓰거나, 사용자 입력 처리를 지연시키거나, 대화 컨텍스트를 오염시키는 것.

### 4.2 (c) 메인 루프 예산과 오프로딩 기준

**메인 루프 예산 (경성 수치):**

| 항목 | 예산 | 근거 |
|---|---|---|
| 인터랙티브 턴 1회 벽시계 | ≤ 3초 (p95) | 분류 + 위임 + ACK만 하므로 LLM 1회 호출 수준 |
| 알림 주입 1회 | ≤ 1.5KB / ≤ 5 이벤트 | 기존 `JobDeskInjector` 캡(MAX_CHARS=1500, MAX_EVENTS=5) 유지 |
| 알림 주입 빈도 | 턴당 최대 1블록 | `DynamicInjector` 사이클 스로틀 유지 |
| 알림 처리 도구 호출 | 회당 ≤ 250ms (원장 읽기) | JobInbox/JobList는 메모리 원장 조회 |

**오프로딩 판정표:**

| 알림 종류 | 처리 주체 | 이유 |
|---|---|---|
| 워커 진행 이벤트(스트리밍) | TUI 직접 (job.* 이벤트 → 보드). **메인 턴 깨움 금지** | 사용자가 보는 것이지 모델이 읽을 것이 아님 |
| 완료/실패 단건 | 메인에 인박스 기록 + 토스트. 요약 응답은 사용자 발화 시에만 | v1 방식 유지 — 검증됨 |
| 완료 폭주(5분 내 ≥5건) 또는 실패 연쇄(동일 사유 ≥2건) | **전용 desk 워커**가 digest: 중복 제거, 그룹핑, 1건 에스컬레이션 카드 생성 | 메인 턴이 digest 루프로 길어지는 것을 차단 |
| needs_user 카드 | 메인 경유 사용자 전달 (즉시, 단건) | 사용자 판단이 필요하므로 오프로드 불가 |
| 머지 신뢰 판정 | 메인(판정) + 랜딩 워커(실행, §3 G5) | 판정은 가볍고 실행은 무거움 |

**desk 워커 설계:** `models.fast` 슬롯의 저비용 워커(kind=`desk`)가 인박스 배치(≥5건 또는 사용자 명령 `/job digest`)를 받아 구조화 digest를 만든다. 산출물은 ① TUI 보드 요약 갱신 ② 메인 인박스에 단일 에스컬레이션 카드. 메인 턴은 그 카드를 "읽기"만 한다. digest 처리 중 새 알림이 들어와도 desk 워커의 큐에 쌓일 뿐 메인 턴은 건드리지 않는다.

**위반 시 실패 모드:** 알림 처리가 예산을 초과하면(주입 1.5KB 초과 시도, 한 턴에 알림 도구 3회 이상 호출) 런타임이 주입을 캡·드로ップ하고 드롭 사실을 스트립에 표시(`inbox N (batched)`) — 알림 손실은 digest가 복구한다.

## 5. 불변 조건 4 — 컨트롤 타워 TUI

### 5.1 정의

Conductor의 기본 화면은 **워커 보드(컨트롤 타워)**다. 코더 트랜스크립트를 재활용하거나 그 위에 스트립을 붙이는 방식(v1)은 금지한다. 트랜스크립트는 드릴다운 대상 중 하나로 내려가고, 제1 서피스는 보드다.

참조 UX: Claude Code agent view(상태 그룹핑 + 입력 필요 상단 고정 + peek/attach), Codex 사이드바(증거 인용), 리서치 §4.2의 다중 스트림 TUI 패턴. 그러나 기존 트랜스크립트 컴포넌트 재사용이 아니라 **전용 렌더 경로**로 짓는다.

### 5.2 (d) 화면 구성 (IA)

```
┌──────────────────────────────────────────────────────────────┐
│ [S1] 워커 보드 (기본 화면)                                     │
│  needs_user  ▣ job_abc  인터뷰 대기 3분        [Enter=답변]    │
│  running     ▶ job_def  테스트 수정 (auth.ts)  2:14  ▓▓▓░     │
│  running     ▶ job_ghi  docs 정제              0:41  ▓░░░     │
│  queued …    2 대기 (백프레셔 6/6)                            │
│  done/failed 최근 5건 (접힘)                                   │
├──────────────────────────────────────────────────────────────┤
│ [S4] Conductor 대화 (컴팩트, 항상 입력 가능 — 하단 고정)       │
│  > "auth 버그 잡아줘" → job_def 배정 ACK                       │
└──────────────────────────────────────────────────────────────┘
  Esc=보드 복귀 │ Enter=드릴다운(S2) │ q=큐 패널(S3) │ /=입력
```

- **S1 보드(기본)**: 상태별 그룹(needs_user → running → queued → blocked → 최근 종료), 각 행 = id, 제목, 경과, 최신 이벤트 1줄, 미니 진행. 입력 필요 항목 상단 고정.
- **S2 드릴다운(peek/attach)**: Job 선택 시 우측/전환 페인으로 이벤트 스트림 + diff 요약 + steer 입력. attach 시 전체 워커 트랜스크립트(이때만 기존 트랜스크립트 렌더러 재사용 허용). `←`/`Esc`로 보드 복귀.
- **S3 큐/백프레셔 패널**: 대기열, 우선순위, maxConcurrent 대비 점유, `interrupted` 재개 버튼.
- **S4 대화 페인**: 메인(Conductor)과의 대화 전용. 워커 실행 중에도 **항상 입력 가능**해야 하며(§7), ACK와 에스컬레이션 카드만 흐른다. 워커 로그는 여기에 섞지 않는다.

### 5.3 진입과 실시간 배선

- **진입**: 세션 시작 → S1 보드. `/jobs`·`/job` 슬래시는 유지하되 보드 조작 키에 매핑되는 보조 수단으로 격하.
- **배선(단일 소스)**: `job.updated`/`job.inbox` 프로토콜 이벤트 + 워커 스트리밍 이벤트를 TUI 측 **보드 스토어 1개**가 수용. v1의 `SessionEventJobDesk`(카운터 델타)는 보드 스토어에 흡수·폐기. 렌더는 네이티브 렌더러의 프레임 예산 규칙(`apps/liora/AGENTS.md` 실시간/시각 품질)을 따른다 — 보드는 16ms 셀 무효화, 워커 스트림은 코얼레싱.
- **기존 트랜스크립트와의 관계**: 트랜스크립트 렌더러(`controllers/transcript/*`)는 ① Conductor 대화 페인(S4) ② 워커 attach 뷰(S2 전체 보기) 두 곳의 **하위 뷰어**로만 남는다. 보드 자체는 `features/control-tower/*`(신규)로 짓고, `features/agent-swarm/*`(war-room)은 폐기(인벤토리 B-3).

### 5.4 허용/금지

- 허용: 보드 전용 컴포넌트 신규 작성, 트랜스크립트 뷰어의 하위 재사용, 기존 테마/모션 시스템 활용.
- 금지: 보드를 transcript entry로 표현, 푸터 스트립을 기본 관제로 유지, `features/agent-swarm` 렌더 재활용, 스냅샷 증거 없는 "완료" 선언(E 게이트는 스크린샷/VerifySurface 증거 필수).

## 6. 불변 조건 5 — 레거시 폐기 원칙

### 6.1 (e) 판정 기준 (남길 것 / 재설계할 것 / 삭제할 것)

**유지(KEEP)** — 다음을 전부 만족:
1. 계약/데이터 모델이 v2에서도 진실이며(원장 상태 머신, worktree 격리, 보안 가드)
2. 그것을 증명하는 테스트가 존재하고
3. 다른 경로와 역할이 겹치지 않는다.

**재설계(REBUILD)** — 데이터 모델은 맞지만 런타임 배선이 불변 조건을 위반:
- 판정 신호: `await` 체인이 인터랙티브 턴에 연결됨, 또는 프롬프트로만 억제되는 약속.
- 예: Job 스케줄러(펌프 → 이벤트 구동), 스폰 경로(직접 await → 스폰 큐), 모델 라우팅(暗黙 폴백 → 명시 슬롯).

**삭제(DELETE)** — 다음 중 하나라도 해당:
1. 같은 목적의 다른 경로가 존재(중복 오케스트레이션 스택)
2. 사용자가 도달하는 제품 경로가 아니고 compat 심만 남음
3. 프롬프트 시어터(코드 없이 지시로만 존재하는 동작)
- 예: `orchestratorMode` 스택, UltraSwarm 합의/토론 기계, AgentSwarm 템플릿, SpawnWorker 브리지(인벤토리 B장 전수).

### 6.2 폐기 전 테스트 가드레일 (의무)

삭제 PR은 아래 없이는 병합 불가:
1. **캐릭터라이제이션 테스트**: 삭제 대상의 현재 외부 동작(도구 입출력, 이벤트 방출, 원장 전이)을 고정하는 테스트를 먼저 추가.
2. **대체 경로 증명**: 그 기능이 필요했다면 v2의 어느 경로로 가는지를 테스트로 보임 (예: SpawnWorker 삭제 전, JobCreate로 동일 작업이 위임되는 테스트).
3. **참조 제거 확인**: `pnpm run check:imports` + 삭제 심볼 grep 0건.
4. **베이스라인 래칫**: `check:test-baseline` 통과(삭제로 줄어드는 pinned 실패는 베이스라인 갱신으로 반영).

### 6.3 폐기의 순서 원칙

가드(불변 조건 강제)가 먼저, 대체 경로가 둘째, 삭제가 마지막. 가드 없이 삭제하면 모델이 하위 호환 도구로 우회하고, 대체 없이 삭제하면 사용자 기능이 사라진다. 상세 순서는 인벤토리 C장.

## 7. 메인 루프 모델 재정의 (입력 → 분류 → 위임 → ACK)

### 7.1 기존 모델과의 단절

v1의 메인 루프는 "코딩 에이전트의 단일 턴 루프에 Job 도구를 붙인" 것: 사용자 입력 → (기존 conversation-loop의 도구 루프) → 응답. 턴 길이 상한이 없어 입력 큐잉이 블로킹으로 전환된다.

v2의 메인 루프는 **분류기 루프**다. 도구 루프가 아니라 `입력 → 분류 → 위임 → ACK`의 고정 4단계를 돌며, 각 단계는 예산이 있다.

### 7.2 루프 정의

```
사용자 입력
   │ (언제든 접수 — 턴 점유와 무관)
   ▼
[1] 접수 (immediate, <1ms)
   입력을 세션 입력 큐가 아니라 메인 루프의 첫 단계로 직접 전달.
   "턴이 바빠서 큐잉" 상태 자체를 없앤다.
   ▼
[2] 분류 (bounded)
   1차: 결정적 사전 분류기 (classifyConductorLane 확장 — regex/길이/동사 사전).
        → 'status_query' / 'steer' / 'cancel' / 'job_intent' / 'qa' 등 태그.
   2차: LLM 마이크로턴 (models.fast, 출력 토큰 상한, 도구 호출 없음).
        → {action, target, split?[]}
   분류 예산: p95 ≤ 1.5초. 분류 자체는 절대 도구를 호출하지 않는다.
   ▼
[3] 라우팅 (action별 단일 경로)
   direct_answer  → Conductor가 직접 짧은 응답 (도구 루프 없음)
   job_create     → JobCreate (G1 데드라인 내 ACK)  — 멀티 인텐트면 auto_split
   steer/cancel   → JobSteer/JobCancel (원장 I/O만)
   status_query   → 원장/보드 스냅샷 읽기 (읽기 전용)
   merge_decision → 신뢰 규칙 판정 → 랜딩 워커 위임 (G5)
   clarify        → AskUserQuestion (needs_user 카드)
   ▼
[4] ACK (템플릿 즉시 렌더)
   분류가 결정적이면 LLM 응답을 기다리지 않고 UI가 즉시 ACK
   ("job_def 배정 — worktree 준비 중"). LLM ACK는 그 뒤에 스트림으로 보강.
   ACK는 절대 "작업 완료"를 약속하지 않는다. 접수/배정 사실만 약속.
```

### 7.3 루프 불변량

- **인터랙티브 턴은 LLM 호출 최대 1회** (분류 마이크로턴 또는 direct_answer 생성). 2회 이상 연속 LLM 호출이 필요한 순간 그 작업은 Job으로 가야 한다는 신호다.
- **도구 루프 부재**: 메인 루프는 분류기가 선택한 action을 실행하는 고정 코드 경로다. 모델이 도구 루프를 도는 것은 AskUserQuestion과 원장 조회만 예외.
- **입력 드롭 0건**: 분류 실패(타임아웃/에러)는 폴백 action=`job_create`(단일 Job)로 수렴. 어떤 입력도 조용히 버려지지 않는다 (v1 A3 계승).
- **ACK 우선 렌더**: 보드/스트립 갱신과 ACK는 LLM 토큰 스트림과 분리된 즉시 경로다.

### 7.4 구현 귀결

- `loop/run-turn.ts` 기반 메인 턴은 conductor에서 **분류기 엔트리로 교체**되고, 기존 도구 루프는 워커 전용이 된다.
- `streamingPhase !== 'idle'` → `enqueueMessage` 경로(`message-dispatch.ts`)는 메인 루프 재설계로 소멸: 입력은 항상 [1]로 간다.
- `classifyConductorLane`은 조언 휴리스틱에서 **분류기의 1차 결정 단계**로 승격하며, 그 판정은 이벤트로 기록된다(관측/테스트 가능).

## 8. 구현 스트림 분할

소유권(파일 영역)이 겹치지 않는 병렬 단위. 각 스트림은 독자 PR 시리즈로 진행하고, 병합 순서만 의존한다.

| 스트림 | 이름 | 파일 영역 (배타 소유) | 선행 의존 | 검증 기준 |
|---|---|---|---|---|
| **S0** | 가드 코어 | `packages/agent-core/src/loop/*` (tool-call-execute/guards 확장), `profile/default/conductor.yaml`, `profile/main-profile.ts`, 신규 `agent/conductor-guard.ts` | 없음 (최초 착수) | §2 가드 테스트: Write 거부+Job 초안, 도구 벽시계 트리프와이어, 프로필 스냅샷 |
| **S1** | Job 런타임 v2 | `packages/agent-core/src/tools/builtin/job/*`, `fleet/spawn-agents.ts`, `session/subagent/subagent-host.ts` (스폰 큐 분리), `utils/cheap-model.ts` (모델 슬롯) | S0의 가드 인터페이스(도구 예산) | §3 G1~G4: ACK p99 250ms, 스폰 120초 주입에도 ACK 정상, await-zero 스캔 0건, 403 라우팅 회귀 테스트 |
| **S2** | 컨트롤 타워 TUI | `apps/liora/src/tui/features/control-tower/*` (신규), `controllers/session-event/job-desk.ts` 교체, `commands/jobs.ts` 재배선 | S1 이벤트 계약(`job.*` v2) — 목 이벤트로 선착수 가능 | §5: 보드 렌더 스크린샷 증거, 입력 항상성 테스트(워커 3개 중 입력 즉시 ACK), VerifySurface 스모크 |
| **S3** | 레거시 폐기 | `tools/builtin/fleet/orchestrator.ts`, `fleet/ultra-swarm*`, `session/ultra-swarm-*`, `agent/orchestrator.ts`, `agent/ultra-swarm-run.ts`, `tools/builtin/collaboration/*`, TUI `features/agent-swarm/*`·`commands/swarm|ultrawork` | S0+S1 병합(대체 경로 존재) 후 | §6.2 가드레일 4종 전부; 삭제 후 `check:imports`·grep 0건·베이스라인 래칫 |
| **S4** | desk 워커 + 프로토콜 v2 | `protocol/src/events/job.ts` (v2 필드), 신규 desk 워커 kind (`tools/builtin/job/job-desk.ts`), `agent/injection/job-desk.ts` | S1 원장/이벤트 안정화 | §4: 완료 폭주 digest 테스트, 주입 캡 테스트, journal 스키마 이중 읽기 |

**병렬성:** S0∥S1 (영역 비겹침) → S2 (S1 계약 이후 본배선) ∥ S4 → S3 마지막. S3을 제외한 4개 스트림은 상시 병행 가능.

**공통 금지:** 어느 스트림도 다른 스트림 소유 파일을 "잠깐" 수정하지 않는다. 크로스 스트림 변경이 필요하면 인터페이스 이슈로 분리해 순서 병합한다. (오늘의 스파게티가 바로 이 규칙 부재에서 생겼다.)

## 9. 수락 게이트 (v2 Definition of Done)

전부 기계 측정 가능해야 하며, 하나라도 미달이면 v2 미완료:

- **V1 (delegation)**: conductor 프로필에서 Write/Edit/ApplyPatch/장기 Bash 호출 100% 거부 (가드 테스트 스위트 그린).
- **V2 (비동기)**: 워커 수명 `await` 경로 정적 스캔 0건 + 시간 가상화 테스트에서 120초 스폰 지연 중 ACK p99 ≤ 250ms.
- **V3 (입력 항상성)**: 워커 3개 + 완료 폭주 상황에서 사용자 입력 → ACK 렌더 p95 ≤ 1초 (TUI 계측).
- **V4 (알림)**: 완료 10건 동시 도착 시 메인 턴 증가 ≤ 1회, digest 워커가 1건 에스컬레이션 생성.
- **V5 (TUI)**: 컨트롤 타워 기본 화면 스크린샷/VerifySurface 증거 + needs_user 상단 고정/peek/attach 조작 증거.
- **V6 (폐기)**: 인벤토리 B장의 DELETE 판정 항목 전부 삭제 완료, 잔재 심볼 grep 0건, 베이스라인 래칫 그린.
- **V7 (사고 재발 방지)**: 오늘의 두 사고(125초 스폰 블로킹, exploration_model 403) 재현 시나리오가 회귀 테스트로 고정되어 레드→그린 증명.

## 10. 리스크 레지스터

| 리스크 | 영향 | 완화 |
|---|---|---|
| 분류기 오판으로 사소한 질의가 Job화 | 비용/지연 증가 | 분류기 confidence 임계값 + direct_answer 우선; 폴백은 "질문" 쪽으로 |
| 메인 루프 교체 중 기존 세션 호환 | journal 리플레이 깨짐 | journal 스키마 버전 필드 + 이중 읽기 (v1 F3 원칙 계승) |
| 스폰 큐가 새 병목이 됨 | 워커 시작 지연 | 스폰 예산 30초 + `spawning` 상태 가시화 + 웜풀 |
| UltraSwarm 의존성 제거 중 Mission 회귀 | Mission 파손 | Mission-스웜 결합 분리 전용 캐릭터라이제이션先行 (인벤토리 B-2) |
| TUI 재설계 범위 팽창 | 일정 | S2는 보드/드릴다운/큐 3화면 고정, 그 외 v2.x로 이월 |
| 삭제 반발(기능 상실감) | 채택 저항 | §6.2 "대체 경로 증명" 의무 — 사라지는 기능마다 Job 경로 대체를 시연 |
