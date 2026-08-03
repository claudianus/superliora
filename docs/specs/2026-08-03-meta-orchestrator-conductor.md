# Meta Orchestrator (Conductor) — progress notes

Date: 2026-08-03  
Status: P0–P4 landed (Conductor default, Job ledger/pool/warm pre-spawn, Mission-as-Job, TUI strip + toasts + drill-down, Fleet bridge, merge trust, push ban, protocol `job.*` events); P5 verification gate green (2026-08-03)

## Product defaults
- Main profile hard-default: **`conductor`**
- Worker waist: **`core`** (Core≤12) via `SUPERLIORA_PROFILE=core`
- Coding waist: **`agent`** (≤30) / **`superliora-full`**

## P0 surface
- Mission lifecycle required: EnterPlanMode, NextPhase, ExitPlanMode, RecordInterviewFinding, CreateGoal, GetGoal, UpdateGoal
- Mission create hard-fails if active profile lacks lifecycle tools
- Job ledger tools: JobCreate, JobList, JobInspect, JobSteer, JobCancel, MergeJob

## P1 landed
- `scheduleQueuedJobs` with maxConcurrent default 6 (env `SUPERLIORA_CONDUCTOR_MAX_CONCURRENT`)
- warm pool config default 2 (`SUPERLIORA_CONDUCTOR_WARM_POOL`) + live pre-spawn (see P4)
- always-worktree when agent kaos+cwd available; injectable createWorktree for tests
- failed worktree → job `blocked` (no silent shared cwd)
- GC helpers: success remove + fail TTL 7d via `gcConductorJobWorktrees`
- JobCreate auto-schedules; JobSchedule manual pump (on full profile; conductor relies on JobCreate pump)

## P1.5 landed
- FanoutTask.worktreeDir → subagent child cwd
- `launchJobWorker`: background spawn via subagentHost when available
- On worker complete/fail: ledger done/failed + inbox + reschedule pump
- JobCancel aborts live worker; JobSteer delivers to worker when possible

## P1.75 landed (this slice)
- **JobInbox** store + tool (unread notices, mark_read)
- **JobResume** tool + `resumeJobs` (interrupted → queued → schedule)
- `markInFlightJobsInterrupted` / `interruptRunningJobs` for session pause
- `summarizeJobStrip` / `formatJobStripLine` for TUI
- Conductor profile tools: JobResume + JobInbox (≤30; JobSchedule/WebSearch on full)
- TUI: `/jobs`, `/job` (list|inbox|resume|cancel|inspect|gc|schedule)
- Footer Job strip via `appState.conductorJobs` + parse Job* tool output
- Multi-intent: `splitUserMessageIntoJobIntents` + JobCreate `auto_split`
- Tests: job-ledger inbox/resume/strip/split; liora job-strip unit tests

## P3 spine landed
- `job-lanes.ts`: interactive vs execution classification + non-blocking launch contract
- `job-mission-bind.ts`: Mission create → Job ledger (`kind=mission`); pause/cancel/complete sync
- Parallel Jobs remain schedulable while Mission job is running (C2)
- `JobDeskInjector`: capped `<conductor_job_desk>` injection of unread inbox + strip
- `launchJobWorker` documents fire-and-forget completion (meta turn not blocked on worker lifetime)

## Protocol (F3)
- `packages/protocol/src/events/job.ts`: `job.updated` + `job.inbox` with `schemaVersion: 1`
- Wired into `agentEventSchema` discriminated union (old readers ignore unknown if not rebuilt)
- `job-emit.ts` best-effort bus emit from worker inbox path
- TUI `SessionEventJobDesk`: `job.updated` → footer strip; `job.inbox` → toast/notice

## P4 security + merge trust + land + Fleet bridge + warm spawn + Mission cards
- `job-merge-trust.ts` + MergeJob tool: auto only when small∧no conflict∧checks green∧non-dangerous∧summary
- `job-worker-guards.ts` + BashTool: `isWorker` constructor flag (non-`main` agent) hard-denies `git push` / `git send-pack`
- `job-warm-pool.ts`: live pre-spawn via subagentHost (fire-and-forget boots, slot credit on success); warm pool state in tool store (`job_warm_pool`)
- `job-land.ts`: `git merge --no-edit <branch>` into main workspace (no remote push); GC worktree on success
- `job-fleet-bridge.ts`: SpawnWorker ledger registration (compat path); SpawnWorkerTool wired
- `job-mission-bind.ts`: `raiseMissionInterviewCard` — async `needs_user` inbox card without blocking other Jobs
- Mid-tool-loop input path: `/job answer <id> <text>` → `JobResume(answer)` → `needs_user` card re-queued (no blocking session queue)
- journal mirror schema version history documented on `UltraworkRunMirror` (schema 1→2, dual-read accepted)

## P2–P5 final (2026-08-03)
- TUI control tower: `/jobs` + `/job` (list|inbox|resume|answer|cancel|inspect|gc|schedule) + footer Job strip + `job.inbox` toasts; drill-down via `/job inspect <id>` (E1–E3)
- ACK method (A2, WG-P1-2): `JobCreate` performs an immediate ledger upsert and returns `job_id + status` synchronously; worker spawn is fire-and-forget so the meta turn is not blocked on worker lifetime. Local dev `p50 ≤ 2s` target, measured as JobCreate call → ACK round-trip (tool-call synchronous return).
- Burst retain (A3): `auto_split=true` → `splitUserMessageIntoJobIntents` creates one ledger Job per intent (priority decreasing per intent) + a single summary ACK; zero silent drop.
- Scheduler (B2/B3, WG-P3-2): priority-desc then created-at sort; queued→running promotion under `maxConcurrent` (default 6); backpressure is user-visible via the ACK line + `/jobs` queued states.
- Security (F1): worker Bash hard-denies `git push`/`send-pack`; same secret hard-blocks/redaction apply on workers; worktree-root guard (`isPathOutsideWorktree`) for destructive ops.
- Resume (F2): in-flight jobs → `interrupted` on pause; `JobResume` / `/job resume` re-queues them.
- Journal (F3): mirror schema version history documented (schema 1→2, dual-read); `job.*` events carry `schemaVersion: 1`; old readers ignore unknown events.
- Demo evidence pack (G2): AC matrix + verification log → `docs/specs/2026-08-03-conductor-evidence.md`

See plan: `docs/specs/2026-08-03-meta-orchestrator-conductor-goal-plan.md`
