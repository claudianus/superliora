/**
 * Conductor job offload lane (V2-1 ACK deadline + V2-2 spawn isolation).
 *
 * Ledger tools (JobCreate/JobResume/JobSchedule) ACK without awaiting
 * schedule or spawn work; this lane owns that work instead:
 *
 * - `requestJobSchedulePump` coalesces pump requests per store+agent and
 *   starts the drain inline (fire-and-forget). The synchronous portion is
 *   ledger-only; worktree I/O and spawn handshakes suspend onto their own
 *   promises, so the ACK path never blocks. Pump failures are logged, never
 *   thrown into the caller.
 * - worker spawns run behind the bounded-concurrency `WorkerSpawner` (V2-2):
 *   concurrency follows the job pool setting (`maxConcurrentJobs`), budget-abort
 *   after 30s, and budget-exceeded spawns recorded as `blocked` on ledger + inbox.
 *
 * The pump drain starts inline — not on a later macrotask — so a just-created
 * job's spawn handshake begins (microtask lane) before the JobCreate ACK
 * continuation. The ACK can therefore observe `spawning` transitions without
 * awaiting them, and the V7-1 120s-spawn incident cannot block the lane.
 */

import type { Agent } from '../../agent';
import { emitJobEvents, jobRecordToUpdatedEvent } from '../../tools/builtin/job/job-emit';
import { getJob, listJobs, type JobRecord } from '../../tools/builtin/job/job-ledger';
import { patchJobAndNotify } from '../../tools/builtin/job/job-notify';
import { abortJobWorker, bindJobWorkerHost, clearJobWorkerHost, getJobWorkerHost, type JobWorkerHost } from '../../tools/builtin/job/job-handles';
import { abortJobNativeOperations, holdJobNativeAdmission, retainJobNativeCleanup } from '../../tools/builtin/job/job-native-resources';
import {
  areJobAdmissionsOpen,
  closeJobAdmissions,
  resolveConductorPoolConfig,
  scheduleQueuedJobs,
} from '../../tools/builtin/job/job-runtime';
import { launchJobWorker } from '../../tools/builtin/job/job-worker';
import type { ToolStore } from '../../tools/store';
import { JOB_WORKER_SPAWN_BUDGET_MS, WorkerSpawner } from './worker-spawner';


export interface JobSchedulePumpRequest {
  readonly store: ToolStore;
  readonly agent?: Agent;
  readonly workerHost?: JobWorkerHost;
}

interface OffloadState {
  pumpRequests: JobSchedulePumpRequest[];
  pumpInFlight: Promise<void> | undefined;
}

const state: OffloadState = {
  pumpRequests: [],
  pumpInFlight: undefined,
};

const workerSpawners = new WeakMap<ToolStore, WorkerSpawner>();

/** Synchronously stop admission and discard this session's unstarted handshakes. */
export function closeJobRuntime(store: ToolStore): void {
  closeJobAdmissions(store);
  const reason = new Error('Job runtime closed');
  abortJobNativeOperations(store, undefined, reason);
  clearJobWorkerHost(store);
  for (let index = state.pumpRequests.length - 1; index >= 0; index -= 1) {
    if (state.pumpRequests[index]?.store === store) state.pumpRequests.splice(index, 1);
  }
  for (const job of listJobs(store)) {
    workerSpawners.get(store)?.cancelQueued(job.id);
    abortJobWorker(job.id, reason);
  }
}

export function cancelQueuedJobWorkerSpawn(store: ToolStore, jobId: string): boolean {
  return workerSpawners.get(store)?.cancelQueued(jobId) ?? false;
}

/** Per-store preparation queues preserve each session's pool and cancellation boundary. */
export function getJobWorkerSpawner(store: ToolStore): WorkerSpawner {
  const cap = resolveConductorPoolConfig(process.env, { store }).maxConcurrentJobs;
  let spawner = workerSpawners.get(store);
  if (!spawner) { spawner = new WorkerSpawner({ maxConcurrent: cap }); workerSpawners.set(store, spawner); }
  spawner.setMaxConcurrent(cap);
  return spawner;
}

/**
 * Kinds that run deterministic (or ledger-only) work — not an LLM spawn
 * handshake. Parking them on the WorkerSpawner monopolizes spawn slots and
 * can falsely trip the 30s spawn budget on real merge/push duration.
 */
export function isNonLlmJobLaunch(job: Pick<JobRecord, 'kind'>): boolean {
  return job.kind === 'merge' || job.kind === 'push';
}

/** In-flight deterministic launches for resume/schedule deduplication. */
const nonLlmLaunchKeys = new WeakMap<ToolStore, Set<string>>();

/**
 * V2-2 spawn wiring: queue one job-worker spawn behind the serialized
 * spawner. Emits `spawn:*` transition events; budget-exceeded handshakes are
 * recorded as blocked (ledger + inbox). Returns synchronously.
 *
 * Merge and push bypass spawn preparation slots.
 */
export function enqueueJobWorkerSpawn(input: {
  readonly store: ToolStore;
  readonly agent: Agent;
  readonly job: JobRecord;
  readonly workerHost?: JobWorkerHost;
}): { readonly queued: boolean; readonly duplicate: boolean } {
  const { store, agent, job } = input;
  if (!areJobAdmissionsOpen(store, job.id)) return { queued: false, duplicate: false };
  const workerHost = input.workerHost ?? getJobWorkerHost(store);
  let launchKeys = nonLlmLaunchKeys.get(store);
  if (!launchKeys) { launchKeys = new Set(); nonLlmLaunchKeys.set(store, launchKeys); }
  if (isNonLlmJobLaunch(job)) {
    if (launchKeys.has(job.id)) {
      return { queued: false, duplicate: true };
    }
    launchKeys.add(job.id);
    const release = holdJobNativeAdmission(store, job.id, [job.worktreePath, job.parentJobId ? getJob(store, job.parentJobId)?.worktreePath : undefined]);
    // Deterministic executors record Git outcomes on the ledger/inbox.
    release();
    const launching = launchJobWorker({ store, agent, job, workerHost });
    void launching
      .then((result) => {
        if (!result.ok) {
          agent.log?.warn?.('conductor non-LLM job launch failed', {
            jobId: job.id,
            kind: job.kind,
            error: result.error,
          });
        }
      })
      .catch((error: unknown) => {
        retainJobNativeCleanup(store, job.id, error);
        // Failure isolation: a rejected launch (ledger/notify/store error on
        // the merge/push path) must never become an unhandled rejection.
        agent.log?.warn?.('conductor non-LLM job launch rejected', {
          jobId: job.id,
          kind: job.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        launchKeys.delete(job.id);
        release();
      });
    return { queued: true, duplicate: false };
  }
  const release = holdJobNativeAdmission(store, job.id, [job.worktreePath]);
  const admission = getJobWorkerSpawner(store).enqueue({
    key: job.id,
    run: async ({ signal }) => {
      try {
        release();
        const launching = launchJobWorker({ store, agent, job, signal, workerHost });
        const result = await launching;
        if (!result.ok) throw new Error(result.error ?? 'launch failed');
      } finally { release(); }
    },
    onCancel: release,
    onPhase: (phase) => {
      const current = getJob(store, job.id) ?? job;
      emitJobEvents(agent, [jobRecordToUpdatedEvent(current, { reason: `spawn:${phase}` })]);
    },
    onTimeout: () => {
      holdJobForSpawnBudget(store, job.id, agent);
    },
  });
  if (!admission.queued) release();
  return admission;
}

/** A timed-out worker-host handshake is held for explicit resume. */
function holdJobForSpawnBudget(
  store: ToolStore,
  jobId: string,
  agent?: Agent,
): void {
  const current = getJob(store, jobId);
  // Budget expiry must not resurrect a job that left `running` while the
  // handshake was hung (user cancel / terminal failure / recovery) —
  // record a blocked hold only for a still-live spawn.
  if (current === undefined || current.status !== 'running') return;
  patchJobAndNotify(
    store,
    jobId,
    {
      status: 'blocked',
      notes: [
        current.notes,
        `spawn_budget_exceeded: >${JOB_WORKER_SPAWN_BUDGET_MS}ms; held for resume`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      agent,
      summary: `spawn budget exceeded (${JOB_WORKER_SPAWN_BUDGET_MS}ms)`,
    },
  );
}

async function runSchedule(request: JobSchedulePumpRequest): Promise<void> {
  const { store, agent } = request;
  if (!areJobAdmissionsOpen(store)) return;
  if (agent === undefined) {
    // No agent → no spawn path and no stall watchdog. Promoting here flips
    // jobs to `running` that no worker can ever attach to (zombie pool slots
    // until manual JobResume). Leave them queued for an agent-backed pump.
    return;
  }
  const pool = resolveConductorPoolConfig(process.env, { store });
  const kaos = agent?.kaos;
  const repoPath = agent?.config.cwd;
  const result = await scheduleQueuedJobs({
    store,
    kaos,
    repoPath,
    maxConcurrent: pool.maxConcurrentJobs,
    requireWorktree: kaos !== undefined && repoPath !== undefined,
    log: agent?.log,
    agent,
    launchWorker: async (job) => {
      enqueueJobWorkerSpawn({ store, agent, job, workerHost: request.workerHost ?? getJobWorkerHost(store) });
    },
  });
  agent?.log?.debug?.('conductor schedule pump (offload lane)', {
    message: result.message,
    started: result.started.map((j) => j.id),
  });
}

/**
 * Schedule pump request (V2-1). Coalesced per store+agent pair. The drain
 * runs detached from the interactive ACK path; callers that need promotion
 * (JobResume / fleet recovery) may await the returned promise. Failures stay
 * on this lane (logged), never thrown to the caller.
 *
 * Await semantics: the returned promise covers the caller's own request. When
 * a drain is already in flight, it awaits that drain and, if the request (or
 * any later one) landed in the tail window for the re-armed follow-up drain,
 * chains onto it — an awaiting JobResume must never observe its job still
 * `queued` because it held a stale drain promise.
 */
export function requestJobSchedulePump(request: JobSchedulePumpRequest): Promise<void> {
  if (!areJobAdmissionsOpen(request.store)) return Promise.resolve();
  if (request.workerHost) bindJobWorkerHost(request.store, request.workerHost);
  const dup = state.pumpRequests.some(
    (pending) => pending.store === request.store && pending.agent === request.agent,
  );
  if (!dup) state.pumpRequests.push(request);
  return runPumpDrain();
}

async function runPumpDrain(): Promise<void> {
  const inFlight = state.pumpInFlight;
  if (inFlight !== undefined) {
    await inFlight;
    // Requests that landed while the previous drain was exiting are picked up
    // by the re-armed follow-up; wait for it so awaiters see their promotion.
    if (state.pumpRequests.length > 0) return runPumpDrain();
    return;
  }
  const drain = (async () => {
    while (state.pumpRequests.length > 0) {
      const request = state.pumpRequests.shift();
      if (request === undefined) break;
      try {
        await runSchedule(request);
      } catch (error) {
        // Failure isolation: a broken pump must never reach an ACK path.
        const detail = error instanceof Error ? error.message : String(error);
        request.agent?.log?.warn?.('conductor schedule pump failed (offload lane)', {
          error: detail,
        });
      }
    }
  })();
  state.pumpInFlight = drain;
  void drain.finally(() => {
    if (state.pumpInFlight === drain) state.pumpInFlight = undefined;
    // Requests that landed while the loop was exiting re-arm the drain.
    if (state.pumpRequests.length > 0) void runPumpDrain();
  });
  return drain;
}
