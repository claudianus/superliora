/**
 * Conductor job offload lane (V2-1 ACK deadline, contract §3).
 *
 * Ledger tools (JobCreate/JobResume/JobSchedule) ACK immediately and hand
 * schedule+spawn work to this lane instead of awaiting it:
 *
 * - `requestJobSchedulePump` defers the scheduler via setImmediate and
 *   coalesces repeated requests; pump failures are logged, never thrown
 *   into the ACK path;
 * - worker spawns go through the serialized `WorkerSpawner` (V2-2) so a
 *   slow or hung spawn handshake cannot block the pump, the caller, or
 *   other spawns; budget-exceeded spawns are recorded as `blocked` on the
 *   ledger and inbox.
 *
 * The interactive lane observes progress through the ledger, inbox, and
 * job.* events — never by awaiting this module.
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

export interface JobSchedulePumpRequest {
  readonly store: ToolStore;
  readonly agent?: Agent;
}

export interface JobOffloadImpl {
  /** Runs one scheduler pump. Injectable for latency-injection tests. */
  readonly runSchedule: (request: JobSchedulePumpRequest) => Promise<void>;
}

interface OffloadState {
  pumpRequests: JobSchedulePumpRequest[];
  pumpScheduled: boolean;
  pumpInFlight: Promise<void> | undefined;
}

const state: OffloadState = {
  pumpRequests: [],
  pumpScheduled: false,
  pumpInFlight: undefined,
};

let implOverride: Partial<JobOffloadImpl> | undefined;

const workerSpawner = new WorkerSpawner();

/** Shared spawner instance used by the schedule pump. */
export function getJobWorkerSpawner(): WorkerSpawner {
  return workerSpawner;
}

/**
 * V2-2 spawn wiring: queue one job-worker spawn behind the serialized
 * spawner. Emits `spawning` transition events and records budget-exceeded
 * spawns as blocked (ledger + inbox). Returns synchronously.
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
          // surfaces it as a `spawn_failed` spawner phase.
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
        emitJobEvents(agent, [jobRecordToUpdatedEvent(updated, { reason: 'spawn_budget_exceeded' })]);
      }
    },
  });
}

async function defaultRunSchedule(request: JobSchedulePumpRequest): Promise<void> {
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

function activeRunSchedule(): JobOffloadImpl['runSchedule'] {
  return implOverride?.runSchedule ?? defaultRunSchedule;
}

/**
 * Fire-and-forget schedule pump request (V2-1). Returns immediately — the
 * scheduler runs on a deferred drain, coalesced per store+agent pair.
 */
export function requestJobSchedulePump(request: JobSchedulePumpRequest): void {
  const dup = state.pumpRequests.some(
    (pending) => pending.store === request.store && pending.agent === request.agent,
  );
  if (!dup) state.pumpRequests.push(request);
  ensurePumpScheduled();
}

function ensurePumpScheduled(): void {
  if (state.pumpScheduled || state.pumpInFlight !== undefined) return;
  state.pumpScheduled = true;
  setImmediate(() => {
    state.pumpScheduled = false;
    void runPumpDrain();
  });
}

async function runPumpDrain(): Promise<void> {
  if (state.pumpInFlight !== undefined) return state.pumpInFlight;
  const drain = (async () => {
    while (state.pumpRequests.length > 0) {
      const request = state.pumpRequests.shift();
      if (request === undefined) break;
      try {
        await activeRunSchedule()(request);
      } catch (error) {
        // Failure isolation: a broken pump must never reach an ACK path.
        const detail = error instanceof Error ? error.message : String(error);
        request.agent?.log?.warn?.('Conductor schedule pump failed (offload lane)', {
          error: detail,
        });
      }
    }
  })();
  state.pumpInFlight = drain;
  void drain.finally(() => {
    if (state.pumpInFlight === drain) state.pumpInFlight = undefined;
    if (state.pumpRequests.length > 0) ensurePumpScheduled();
  });
  return drain;
}

/** Test seam: override offload behavior (e.g. latency injection). */
export function __setJobOffloadImplForTest(override: Partial<JobOffloadImpl>): void {
  implOverride = override;
}

/** Test seam: clear overrides and pending offload state. */
export function __resetJobOffloadForTest(): void {
  implOverride = undefined;
  state.pumpRequests = [];
  state.pumpScheduled = false;
  state.pumpInFlight = undefined;
}

/** Test seam: drain the pending schedule pumps deterministically. */
export async function __flushJobOffloadForTest(): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    await runPumpDrain();
    if (state.pumpRequests.length === 0 && state.pumpInFlight === undefined) {
      await getJobWorkerSpawner().settle();
      if (state.pumpRequests.length === 0) return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}
