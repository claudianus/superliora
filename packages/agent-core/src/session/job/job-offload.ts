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
 * - worker spawns run behind the serialized `WorkerSpawner` (V2-2): one
 *   handshake at a time, budget-abort after 30s, and budget-exceeded spawns
 *   recorded as `blocked` on ledger + inbox.
 *
 * The pump drain starts inline — not on a later macrotask — so a just-created
 * job's spawn handshake begins (microtask lane) before the JobCreate ACK
 * continuation. The ACK can therefore observe `spawning` transitions without
 * awaiting them, and the V7-1 120s-spawn incident cannot block the lane.
 */

import type { Agent } from '../../agent';
import { emitJobEvents, jobRecordToUpdatedEvent } from '../../tools/builtin/job/job-emit';
import { pushJobInboxEvent } from '../../tools/builtin/job/job-inbox';
import { getJob, patchJob, type JobRecord } from '../../tools/builtin/job/job-ledger';
import {
  resolveConductorPoolConfig,
  scheduleQueuedJobs,
} from '../../tools/builtin/job/job-runtime';
import { launchJobWorker } from '../../tools/builtin/job/job-worker';
import type { ToolStore } from '../../tools/store';
import { JOB_WORKER_SPAWN_BUDGET_MS, WorkerSpawner } from './worker-spawner';

/**
 * G1 ACK budget split (contract §3.3): JobCreate waits at most this long for
 * a fast spawn handshake so the ACK can carry the worker id; slower
 * handshakes keep running in the background and land on ledger/inbox. Kept
 * well under the locked 250ms ACK deadline.
 */
export const JOB_CREATE_ACK_SPAWN_GRACE_MS = 100;

export interface JobSchedulePumpRequest {
  readonly store: ToolStore;
  readonly agent?: Agent;
}

interface OffloadState {
  pumpRequests: JobSchedulePumpRequest[];
  pumpInFlight: Promise<void> | undefined;
}

const state: OffloadState = {
  pumpRequests: [],
  pumpInFlight: undefined,
};

const workerSpawner = new WorkerSpawner();

/** Shared serialized spawner used by the schedule pump (V2-2). */
export function getJobWorkerSpawner(): WorkerSpawner {
  return workerSpawner;
}

/**
 * V2-2 spawn wiring: queue one job-worker spawn behind the serialized
 * spawner. Emits `spawn:*` transition events; budget-exceeded handshakes are
 * recorded as blocked (ledger + inbox). Returns synchronously.
 */
export function enqueueJobWorkerSpawn(input: {
  readonly store: ToolStore;
  readonly agent: Agent;
  readonly job: JobRecord;
}): { readonly queued: boolean; readonly duplicate: boolean } {
  const { store, agent, job } = input;
  return workerSpawner.enqueue({
    key: job.id,
    run: ({ signal }) =>
      launchJobWorker({ store, agent, job, signal }).then((result) => {
        if (!result.ok) {
          // Ledger/inbox already carry the recorded failure; the throw only
          // surfaces it to the spawner as a `spawn_failed` phase.
          throw new Error(result.error ?? 'launch failed');
        }
      }),
    onPhase: (phase) => {
      const current = getJob(store, job.id) ?? job;
      emitJobEvents(agent, [jobRecordToUpdatedEvent(current, { reason: `spawn:${phase}` })]);
    },
    onTimeout: () => {
      const current = getJob(store, job.id);
      const updated = patchJob(store, job.id, {
        status: 'blocked',
        notes: [
          current?.notes ?? job.notes,
          `spawn_budget_exceeded: >${JOB_WORKER_SPAWN_BUDGET_MS}ms; held for resume`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      if (updated) {
        pushJobInboxEvent(store, {
          kind: 'job.blocked',
          jobId: updated.id,
          status: 'blocked',
          title: updated.title,
          summary: `spawn budget exceeded (${JOB_WORKER_SPAWN_BUDGET_MS}ms)`,
        });
        emitJobEvents(agent, [
          jobRecordToUpdatedEvent(updated, { reason: 'spawn_budget_exceeded' }),
        ]);
      }
    },
  });
}

async function runSchedule(request: JobSchedulePumpRequest): Promise<void> {
  const { store, agent } = request;
  const pool = resolveConductorPoolConfig();
  const kaos = agent?.kaos;
  const repoPath = agent?.config.cwd;
  const result = await scheduleQueuedJobs({
    store,
    kaos,
    repoPath,
    maxConcurrent: pool.maxConcurrentJobs,
    requireWorktree: kaos !== undefined && repoPath !== undefined,
    log: agent?.log,
    launchWorker:
      agent !== undefined && agent.subagentHost !== undefined
        ? async (job) => {
            enqueueJobWorkerSpawn({ store, agent, job });
          }
        : undefined,
  });
  agent?.log?.debug?.('conductor schedule pump (offload lane)', {
    message: result.message,
    started: result.started.map((j) => j.id),
  });
}

/**
 * Fire-and-forget schedule pump request (V2-1). Returns synchronously; the
 * pump runs inline-and-detached, coalesced per store+agent pair. Failures
 * stay on this lane (logged), never on the caller/ACK path.
 */
export function requestJobSchedulePump(request: JobSchedulePumpRequest): void {
  const dup = state.pumpRequests.some(
    (pending) => pending.store === request.store && pending.agent === request.agent,
  );
  if (!dup) state.pumpRequests.push(request);
  void runPumpDrain();
}

async function runPumpDrain(): Promise<void> {
  if (state.pumpInFlight !== undefined) return state.pumpInFlight;
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
