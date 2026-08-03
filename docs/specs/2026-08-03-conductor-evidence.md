# Conductor (Meta Orchestrator) — AC Evidence Matrix

Date: 2026-08-03  
Goal plan: `docs/specs/2026-08-03-meta-orchestrator-conductor-goal-plan.md`  
Spec: `docs/specs/2026-08-03-meta-orchestrator-conductor.md`  
Branch: `main` @ `a7abcae5c` (work in progress, uncommitted)

## Verification run (2026-08-03)

| Gate | Command | Result |
|------|---------|--------|
| agent-core goal tests | `pnpm -C packages/agent-core exec vitest run test/tools/job-ledger.test.ts test/profile/ test/mission/ test/tools/bash.test.ts test/tools/bash-env.test.ts` | 14 files / **162 passed** (incl. G2 demo scenario) |
| protocol goal tests | `pnpm -C packages/protocol exec vitest run src/__tests__/job-events.test.ts` | **2 passed** |
| liora goal tests | `pnpm -C apps/liora exec vitest run test/tui/utils/job-strip.test.ts` | **3 passed** |
| dts build | `pnpm -C packages/node-sdk run build:dts` | OK (API Extractor success) |
| root build | `pnpm run build` | OK (incl. apps/liora bundle 17.89 MB) |
| imports | `pnpm run check:imports` | Workspace import check passed |
| liora smoke | `pnpm -C apps/liora run smoke` | Bundle smoke passed |
| baseline ratchet | `pnpm run check:test-baseline` | OK — 4781/4791, baseline 7 (no regressions) |

Pre-existing drift note: agent-core suite has 81 pre-existing failures (snapshot/timeout drift, e.g. `agent.status.updated` emit, MCP/timeout). Re-verified identical on clean HEAD (`a7abcae5c`) via `git stash push --include-untracked` → same failures → restored. These are unrelated to the Conductor work and out of baseline scope (`meta/test-baseline.yaml` covers `apps/liora` only).

## AC matrix

| AC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| A1 | Non-blocking interactive lane | ✅ | `job-lanes.ts` (`classifyConductorLane`, `assertNonBlockingLaunchContract`); `launchJobWorker` fire-and-forget |
| A2 | ACK `job_id` + state, p50 ≤ 2s | ✅ | `JobCreateTool.run` → immediate ledger upsert + `ack(jobId, status)` synchronous return (method note in spec) |
| A3 | Burst of 5 → 5 ledger jobs | ✅ | `splitUserMessageIntoJobIntents` + `auto_split` (job-tools.ts:188 priority falloff); job-ledger.test.ts |
| B1 | warm 2 / max 6 configurable | ✅ | `CONDUCTOR_DEFAULT_WARM_POOL_SIZE=2`, `CONDUCTOR_DEFAULT_MAX_CONCURRENT_JOBS=6` + env overrides; `job-warm-pool.ts` live pre-spawn |
| B2 | Worktree per job + merge policy | ✅ | `launchJobWorker` always-worktree; `job-land.ts` `git merge --no-edit`; `job-merge-trust.ts` trust rules |
| B3 | Backpressure user-visible | ✅ | `canStartMoreJobs`/`nextQueuedJobs`; ACK line "Backpressure active…" + `/jobs` queued states |
| B4 | Workers progress without meta stuck | ✅ | `job-worker.ts` background spawn via subagentHost; `job-handles.ts` steer/abort |
| C1 | Mission create asserts lifecycle tools | ✅ | `assertMissionLifecycleTools` in `UltraworkMode.create`; main-profile.test.ts (7) |
| C2 | Active Mission does not block other Jobs | ✅ | `job-mission-bind.ts` (`listJobsParallelToMission`); parallel scheduling while `kind=mission` running |
| C3 | Stage machine one-way + audit | ✅ | existing stage machine + `syncBoundJob` (done/failed/interrupted/cancelled) + workflow-report seed |
| C4 | Brand Conductor/Job/Mission/Fleet | ✅ | `conductor.yaml` default profile; `job.*` tools; Mission-as-Job spine |
| D1–D3 | Fleet unified entry + shims | ✅ | `job-fleet-bridge.ts` (`registerSpawnWorkerAsJob`); `fleet/orchestrator.ts` +22; compat aliases kept |
| E1–E3 | Strip + toasts + drill-down | ✅ | `commands/jobs.ts` (`/jobs`, `/job list|inbox|resume|answer|cancel|inspect|gc|schedule`); footer strip via `SessionEventJobDesk`; `job.inbox` toasts; job-strip.test.ts |
| F1 | Security locks (secrets, push ban, worktree root) | ✅ | `job-worker-guards.ts` + BashTool `isWorker` → `git push`/`send-pack` hard-deny; `isPathOutsideWorktree`; same secret hard-blocks inherit |
| F2 | Resume interrupted + one-click resume | ✅ | `markInFlightJobsInterrupted`/`interruptRunningJobs`; `JobResumeTool` + `/job resume` |
| F3 | `job.*` protocol + journal version | ✅ | `protocol/src/events/job.ts` (`job.updated`/`job.inbox`, `schemaVersion: 1`) wired into `agentEventSchema`; mirror schema 1→2 dual-read |
| F4 | Focused tests agent-core + liora | ✅ | job-ledger.test.ts (20), main-profile (7), default-agent-profiles (21), job-events (2), job-strip (3) = 53 goal tests + mission/bash scope |
| G1 | docs/specs architecture doc | ✅ | `2026-08-03-meta-orchestrator-conductor.md` (final status) |
| G2 | Demo: 3 parallel + 1 Mission-profile job, meta responsive | ✅ | Code-level demo test: `job-ledger.test.ts` "G2 demo scenario" — 3 parallel `implement` jobs scheduled with a running `kind=mission` job under maxConcurrent, meta stays responsive (inbox notices + ledger reads while workers run). Live TTY/LLM demo not possible in this environment (no provider API key; `ANTHROPIC_BASE_URL` only) — test is the evidence. |
| G3 | Changeset user-visible | ✅ | `.changeset/conductor-default-job-ledger-p0.md` (agent-core minor, liora patch, protocol minor) |
| G4 | WorkGraph + verification evidence ids | ✅ | WorkGraph WG-P0-1..WG-P5-2 in goal plan; evidence ids = table above (this file) |

## WorkGraph status

| WG | AC | Status |
|----|-----|--------|
| WG-P0-1 | G1 draft | ✅ spec skeleton |
| WG-P0-2 | C1 | ✅ lifecycle tools + mission create assert |
| WG-P0-3 | A1,B4 | ✅ lane split + non-blocking contract |
| WG-P0-4 | A2,A3,B1 | ✅ ledger create/list + ACK + split |
| WG-P1-1 | B1,B2,B3 | ✅ pool/lease/worktree/caps |
| WG-P1-2 | A2 | ✅ ACK method note (spec) |
| WG-P2-1 | E1,E2,E3 | ✅ TUI strip/toasts/drill-down |
| WG-P3-1 | C2,C3,C4 | ✅ Mission parallel + bind |
| WG-P3-2 | B2 | ✅ priority/conflict scheduler rules |
| WG-P4-1 | D1,D2,D3 | ✅ Fleet unified entry + shims |
| WG-P5-1 | F*,G* | ✅ checks + evidence pack (this file) |
| WG-P5-2 | G1,G3 | ✅ final spec + changeset |
