# Meta Orchestrator (Conductor) — Goal Prompt & Execution Plan

작성: 2026-08-03  
대상 레포: `/Users/modumaru/Desktop/code/superliora`  
상태: interview closed 2026-08-03 — FINAL `/goal` paste ready (rounds 1–7 locked)

---

## 0) 한 줄 비전

터미널 세션 하나를 **실행 루프에 묶이지 않는 메타 오케스트레이터(관제 데스크)** 로 만들고, 사용자는 아이디어·지시를 연속으로 던지면 즉시 Job으로 접수·병렬 배정되며, Mission은 long-run Job 스파인으로 흡수한다. GUI 멀티세션 탭 전환 없이 TUI 관제석에서 초고속 병렬 코딩이 가능해야 한다.

---

## 1) `/goal` 에 넣을 프롬프트 (복붙용)

아래 블록 전체를 goal 입력으로 사용한다.

```text
# Goal: SuperLiora Meta Orchestrator (Conductor) — product-grade default harness

## Intent
Make SuperLiora’s default interactive session a **meta-orchestrator control plane**, not a single tool-loop agent that blocks the user while one job runs.

Product truth:
- The user talks only to the meta orchestrator (Conductor).
- User input must never wait on worker execution loops.
- Fleeting ideas and multi-task bursts are captured immediately as Jobs and scheduled onto a worker pool.
- Parallel useful work is the default experience (TUI control tower), competitive with GUI multi-session workflows — without forcing the human to juggle tabs.
- Mission (ex-Ultrawork) is NOT a separate competing mode; it is the **long-running Job spine** under Conductor.
- Fleet / UltraSwarm / SpawnWorker families converge into one execution engine under Conductor.
- Core≤12 remains the **worker waist**, not the main control-plane tool surface.

Canonical source: /Users/modumaru/Desktop/code/superliora
Do not treat empty workspaces as product roots.

## Locked product decisions (do not re-litigate)
- Conductor is **default ON for all users**. Main profile name: `conductor`. `core` = worker tool waist only.
- Ship scope = **full product acceptance A–G** (control tower + pool + Mission-as-Job + demo + spec).
- Brand: **Conductor + Job + Mission + Fleet**. ultra* / orchestratorMode = compat aliases only.
- Isolation: execution-lane Jobs **always use git worktree**. Trivial meta Q&A/1–2-step edits may use main workspace; promoting to Job implies worktree.
- Pool defaults: **warmPoolSize=2**, **maxConcurrentJobs=6** (configurable). Cost guard default: **no token/$ hard cap** — concurrency cap only.
- Worktree GC: delete after **successful merge**; retain failed/cancelled/conflicted worktrees **7 days** + `/job gc`.
- Job APIs always on Conductor schema: **JobCreate, JobList, JobSteer, JobCancel, JobInspect, MergeJob**. Fleet = execution engine (not primary chat API).
- Job ids: **`job_<shortulid>`**.
- Land-to-main: **trust-ruled meta auto-approve** after diff summary when (small diff ∧ no conflict ∧ checks green ∧ non-dangerous paths); else **user confirm**. Never merge on green tests alone without trust rules. Large/risky always user.
- Model routing: explore/research → configured **`models.fast`** (or product-equivalent cheap/fast slot, never hardcoded model id); coder/implement → main-tier model; default tool waist `core`.
- Multi-intent user messages: **auto-split into multiple Jobs** + one summary ACK (fallback single Job if split fails).
- Questions / Mission interview: **Auto** records structured assumptions/auto-answers; **Manual** uses **async question cards** (`needs_user`) without blocking other Jobs. Mission must not monopolize inbox.
- TUI: **bottom compact Job strip + completion toasts**; optional worker drill-down; meta input always available.
- Permissions: meta respects session permission mode; **workers inherit session permission mode** for tools/network. **MergeJob** follows trust rules (not blind auto).
- Session resume: in-flight Jobs → **`interrupted`** + **one-click/one-command resume** (no required live process reconnect).
- Protocol: **new `job.*` events + journal version field**; old readers ignore-unknown. ultrawork.* may remain wire-canonical with mission.* aliases; hard rename purge is follow-up.
- Slash: **`/jobs`**, **`/job`**, **`/job resume`**, **`/job gc`**, keep **`/mission`**.
- Completion path: **meta inbox event + short capped system injection** + toast (no required forced meta-loop kick on every completion).
- Security: **same secret hard-blocks + redaction** on workers; **worker git push/force-push forbidden** (local commits in worktree OK; remote only main/user gated); destructive ops use existing deny/ask **plus worktree-root guard** (no writes outside job worktree).
- Delivery: **vertical slice PR series P0→P5**; main always shippable.
- Plan artifact: `.superliora/plans/meta-orchestrator-conductor-goal.md` (promote into superliora `docs/specs/` during execution).

## Non-goals
- Do NOT only flip `orchestratorMode=true` without interactive vs execution lane split.
- Do NOT force trivial Q&A through worktree workers.
- Do NOT make Mission vs Orchestrator competing user-facing modes.
- Do NOT ship prompt-only theater without Job ledger, pool, scheduling, TUI proof.
- Do NOT break journal replay without versioned migration.
- Do NOT expand Core worker waist without explicit contract + tests.
- Do NOT allow workers to push to remotes or bypass secret hard-blocks.
- Out of scope: perfect ML scheduler, multi-host workers, ultrawork wire hard-purge in one PR.

## Architecture (mandatory)
1) Interactive lane: user ↔ Conductor; always accepts input.
2) Execution lane: worker pool runs Jobs in worktrees asynchronously; completions → meta inbox.
3) Job ledger: id, title, status, priority, paths, budget, mission link, timestamps, result summary.
4) Immediate ACK: task-like input → job_id + state before deep work (p50 ≤ 2s local dev target).
5) Mission-as-Job: long-run stage spine without monopolizing interactive lane.
6) Single engine: Fleet under Job* APIs; SpawnWorker/UltraSwarm compat/absorb.
7) Tool surface: Conductor always has plan/goal lifecycle tools (NextPhase, ExitPlanMode, RecordInterviewFinding, CreateGoal/GetGoal/UpdateGoal, Skill/SearchSkill, Job*, …). Mission create **hard-fails** if surface incomplete.
8) TUI control tower + premium visual bar with screenshot evidence.

## Hard acceptance criteria (all required)
A1 Non-blocking: new user messages accepted while workers run.
A2 ACK with job_id + state ∈ {queued,running,blocked,needs_user,done,failed,cancelled,interrupted} p50 ≤ 2s (document method).
A3 Burst of 5 task ideas → 5 ledger jobs, zero silent drop.
B1 warm 2 / max 6 defaults configurable.
B2 Every execution Job has its own worktree; merge policy as locked.
B3 maxConcurrent backpressure user-visible; no required token hard cap.
B4 Workers progress without meta stuck in long tool loop.
C1 Mission create asserts lifecycle tools present (regression test).
C2 Active Mission does not block other Jobs.
C3 Stage machine one-way + verification audit; no false complete.
C4 User brand Conductor/Job/Mission/Fleet.
D1–D3 Fleet primary engine; Spawn*/UltraSwarm capabilities via unified path or shims.
E1–E3 Job strip + toasts + drill-down; screenshot-proof premium chrome.
F1 Security locks (secrets, push ban, worktree root guard) documented + tested where feasible.
F2 Resume interrupted + one-click resume.
F3 job.* protocol + journal version; no unmigrated replay break.
F4 Focused tests agent-core + liora TUI paths.
G1 docs/specs architecture doc.
G2 Demo: 3 parallel jobs + 1 Mission-profile job; meta still responsive; evidence pack.
G3 Changeset/changelog user-visible.
G4 No complete without WorkGraph + verification evidence ids.

## Work order
P0 Conductor profile + lifecycle tool guarantee + Job ledger MVP + lane split spike
P1 Pool warm2/max6 + always worktree + GC + ACK + Job* tools
P2 TUI strip/toasts/drill-down + screenshots
P3 Mission-as-Job + parallel jobs + async interview cards + model.fast routing
P4 Fleet unification + compat hide + MergeJob trust rules + push ban
P5 Security tests, demo, docs/specs, changesets, completion audit

## Verification
- vitest agent-core (conductor/job/mission/fleet/security guards)
- liora TUI tests where present
- Manual TUI demo + screenshots under .superliora/evidence/
```

---

## 2) Seed Spec (계획 본문)

### 2.1 문제
터미널 코딩 에이전트는 단일 세션·단일 루프에 묶여, 아이디어 폭주·다중 작업 시 GUI 멀티세션 대비 현저히 느리고 손실이 크다. 현재 SuperLiora는 Mission/Fleet/Orchestrator 조각이 있으나:

- 메인이 실행 루프에 점유됨
- Mission 도구 미노출(core 기본)로 long-run 붕괴
- Orchestrator는 플래그·ephemeral 도구 수준
- Job 인박스·풀·관제 UX가 제품 중심이 아님

### 2.2 성공 시 사용자 문장
“탭 안 열어도 생각이 안 죽는다. 말하면 바로 잡 되고, 여러 일이 동시에 돌아가고, 나는 계속 다음 지시를 이어서 던질 수 있다.”

### 2.3 브랜드 (권장 기본안 — 인터뷰로 확정)
| 사용자 표면 | 의미 |
|-------------|------|
| Conductor / 메타 오케스트레이터 | 기본 세션 정체성 |
| Job | 작업 단위 |
| Mission | long-run Job 프로필 |
| Fleet | 실행 엔진 |
| Core | 워커 도구 허리 |

---

## 3) AC Tree

```text
AC-ROOT Product-grade Meta Orchestrator default
├── AC-A Interactive non-blocking + ACK + burst retain
├── AC-B Worker pool + lease + budget + async progress
├── AC-C Mission-as-Job + lifecycle tool guarantee
├── AC-D Fleet unification (compat OK)
├── AC-E TUI control tower + premium visual evidence
├── AC-F Resume/security/protocol safety
└── AC-G Spec + demo + changeset + completion audit
```

각 leaf는 §1 Hard AC A1–G4와 1:1 매핑.

---

## 4) WorkGraph (실행 노드)

| id | stage | owner | dependsOn | AC | evidence |
|----|-------|-------|-----------|----|----------|
| WG-P0-1 | research/design | main | — | G1 draft | spec skeleton path |
| WG-P0-2 | implement | main | WG-P0-1 | C1 | test: lifecycle tools on conductor; mission create assert |
| WG-P0-3 | implement | main | WG-P0-1 | A1,B4 | interactive vs execution lane spike + test/trace |
| WG-P0-4 | implement | main | WG-P0-1 | A2,A3,B1 | Job ledger create/list + ACK protocol |
| WG-P1-1 | implement | main | WG-P0-4 | B1,B2,B3 | pool + lease/worktree + caps tests |
| WG-P1-2 | implement | main | WG-P1-1 | A2 | ACK latency measure note |
| WG-P2-1 | implement | main | WG-P0-4 | E1,E2,E3 | TUI Job strip + toast screenshots |
| WG-P3-1 | implement | main | WG-P0-2,WG-P0-4 | C2,C3,C4 | Mission job parallel with other jobs |
| WG-P3-2 | implement | main | WG-P1-1 | B2 | priority/conflict scheduler rules |
| WG-P4-1 | implement | main | WG-P1-1 | D1,D2,D3 | Fleet unified entry + shims |
| WG-P5-1 | verify | main | all impl | F*,G* | checks + demo evidence pack |
| WG-P5-2 | learn | main | WG-P5-1 | G1,G3 | final spec + changeset + wiki/ledger |

Swarm decision (권장): **ADAPTIVE → ENGAGE on P1–P4**  
- lanes: agent-core runtime, liora TUI, protocol/compat, tests/docs  
- DEFER only pure doc-only spikes

---

## 5) Evaluation Plan

### Mechanical
- unit/integration tests per WG node
- `pnpm`/`vitest` scoped to agent-core + liora packages touched
- typecheck/lint on touched packages

### Semantic
- demo script G2 human review
- AC matrix checkbox in evidence pack

### Consensus / review
- architecture note: lane split correctness
- security: worktree + sandbox
- product: ACK copy & Job strip UX screenshot review

### False-complete bans
- empty WorkGraph
- “orchestratorMode default true” only
- Mission still missing NextPhase on default main
- no demo of concurrent jobs

---

## 6) Execution Plan (스프린트 감각)

### Sprint 0 — Lock (인터뷰)
- 브랜드명, 기본 ON 범위, isolation 기본, ship 슬라이스 경계 확정
- 이 문서 defaults → locked decisions 섹션 갱신

### Sprint 1 — P0 (차단 해제 + 골격)
1. `conductor` 프로필(또는 agent 승격) + main default
2. RecordInterviewFinding on main; Mission tool assert
3. Job ledger store + events (protocol if needed)
4. Interactive lane: user messages not blocked by worker tools (architecture spike → land)
5. ACK path in meta prompt + tool `JobCreate`/`JobList` (names TBD)

### Sprint 2 — P1 Pool
1. Warm pool
2. Lease + worktree policy matrix
3. Budget/backpressure
4. Completion → meta inbox

### Sprint 3 — P2 TUI
1. Job strip chrome
2. Toasts/notices
3. Drill-down
4. Screenshot evidence

### Sprint 4 — P3 Mission-as-Job
1. Mission run ↔ Job id binding
2. Parallel jobs during mission
3. Async interview cards policy

### Sprint 5 — P4 Unify + P5 Verify
1. Fleet single entry
2. Compat aliases
3. Full AC audit + demo + docs + complete

---

## 7) 주요 코드 착지점 (초기 맵)

| 영역 | path hints |
|------|------------|
| Mission | `packages/agent-core/src/mission/*` |
| Fleet | `packages/agent-core/src/fleet/*`, `tools/builtin/fleet/*` |
| Orchestrator tools | `tools/builtin/fleet/orchestrator.ts`, `agent/orchestrator.ts` |
| Profiles | `packages/agent-core/src/profile/default/*`, `main-profile.ts` |
| Subagents | `session/subagent/*` |
| TUI mission/ops | `apps/liora/src/tui/commands/ultrawork/*`, `commands/ops/*` |
| Swarm UI | `apps/liora/src/tui/features/agent-swarm/*` |
| Protocol | `packages/protocol` ultrawork/mission events |

---

## 8) Risk Register

| risk | mitigation |
|------|------------|
| Main turn still blocks input | hard lane split; treat as P0 gate |
| Cost explosion | caps + default warm N small + trivial fast path |
| File conflicts | lease/worktree mandatory matrix |
| Scope infinity | G complete requires demo of concurrent model, not ML scheduler |
| Brand confusion | one user story; ultra aliases only |
| Core≤12 political conflict | core = workers; conductor = main |

---

## 9) Locked decisions (2026-08-03 인터뷰)

| 항목 | 결정 |
|------|------|
| Conductor 기본 적용 | **전 사용자 기본 ON** — 메인 세션 정체성 = Conductor; `core` = 워커 허리 |
| DoD 범위 | **풀 제품 A–G 전부** (관제석+풀+Mission 통합+데모+스펙) |
| 워커 격리 | **항상 worktree** (안전 최우선; lease는 보조 메타데이터 가능하나 격리는 worktree) |
| 브랜드 | **Conductor + Job + Mission + Fleet**; ultra* / orchestratorMode = compat alias |
| main profile 이름 | **`conductor`** 신설 권장, `resolveMainAgentProfileName` 기본값 = `conductor` (`agent`는 wide alias 가능) |
| Job 도구 | **JobCreate/List/Steer/Cancel/Inspect 항상 노출** + **MergeJob**(신뢰 규칙). Fleet=엔진 |
| 워커 풀 | **warm 2 / max concurrent 6** |
| worktree GC | **성공 병합 후 삭제; 실패·취소·충돌 TTL 7일** + `/job gc` |
| 메인 반영 | **신뢰 규칙 메타 자동승인 가능**; 큰/위험 diff는 사용자. 그린만으로 병합 금지 |
| 워커 모델 | explore → **models.fast**; coder → 메인급; waist=`core` |
| 멀티 태스크 | **자동 분해 → 여러 Job + 요약 ACK** |
| 질문 / Mission 인터뷰 | **Auto=가정 기록; Manual=비동기 카드** |
| TUI | **하단 컴팩트 Job strip + 토스트** |
| 권한 | **메타 Auto + 워커 세션 권한 상속** |
| 세션 재개 | **interrupted + 원클릭 resume** |
| 비용 가드 | **max concurrent만** (token/$ 하드캡 없음) |
| 릴리스 | **세로 슬라이스 PR P0→P5** |
| 프로토콜 | **`job.*` 신규 이벤트 + journal 버전**; unknown ignore. ultrawork.* mission alias 유지 |
| 슬래시 | **`/jobs`, `/job`, `/job resume`, `/job gc` + `/mission`** |
| 완료 주입 | **메타 inbox 이벤트 + 짧은 시스템 주입**(컨텍스트 캡) + 토스트 |
| Job id | **`job_<shortulid>`** |
| wire rename | 기능 우선; hard purge 후속 |
| 워커 네트워크 | **세션 권한 상속** |
| 시크릿 | **기존 hard-block + 레닥션, 워커 동일** |
| git push | **워커 금지**; 로컬 커밋 OK; 원격은 메인/사용자 |
| 위험 명령 | **기존 deny/ask + worktree 루트 가드** |
| trivial fast path | Q&A·1–2스텝 메타 직접; 구현 Job=worktree 워커 |

### Isolation note (locked: always worktree)
- 모든 execution-lane Job 워커는 `createSessionWorktree` (또는 후속 통일 API)로 격리.
- 메타 interactive lane의 trivial direct edit는 worktree 예외(메인 workspace) — Job으로 승격되는 순간 worktree.
- 비용/디스크 압력 시 backpressure로 동시 Job 수 축소 (worktree 정책 자체는 유지).

### Security notes (round 7)
- Network: workers inherit session permission mode (WebSearch/Fetch/npm same as main session).
- Secrets: existing hard-block paths + redaction apply equally to workers; do not loosen for worktrees.
- Git remote: **workers must not push** (or force-push) to remotes; local commits inside worktree allowed; push only from main/user gated flows.
- Destructive ops: existing permission/deny rules + **worktree root sandbox** (job cannot modify paths outside its worktree; meta trivial edits still main workspace).

### Ops notes (rounds 2–6)
- Pool: warmPoolSize=2, maxConcurrentJobs=6; no default token/$ hard cap.
- Merge trust rules: small ∧ no conflict ∧ checks green ∧ non-dangerous → meta may auto-approve after summary; else user.
- Fast slot: settings `models.fast` (or product-equivalent).
- Protocol: new `job.*` events + journal version field; dual-read old clients ignore-unknown.
- Slash: `/jobs`, `/job <id>`, `/job resume`, `/job gc`; keep `/mission`.
- Completion: meta inbox event + capped system injection + toast; no mandatory forced meta loop kick.
- Job ids: `job_<shortulid>`.
- Resume interrupted + one-click; vertical PRs P0→P5.
- TUI: bottom Job strip + toasts; multi-intent auto-split.

---

## 10) 사용 방법

1. 인터뷰로 §9 잠금 (거의 완료 — 원하면 보안 라운드)
2. §1 코드블록(갱신본)을 `/goal` 또는 Mission objective로 붙여넣기
3. 이 파일을 plan artifact로 첨부/경로 참조
4. WorkGraph를 TaskGraph/Todo로 시드 후 ENGAGE
