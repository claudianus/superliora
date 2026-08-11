/**
 * Post-resume Conductor fleet recovery.
 *
 * After hard kill / session close, stale running jobs become `interrupted`.
 * Safe kinds auto-requeue; merge/push/needs_user/blocked stay held for the
 * operator (inbox `recovery.held`).
 */

import { parseBooleanEnv, resolveConfigValue } from '../../../config';
import type { Agent } from '../../../agent/index';
import {
  getJobWorkerSpawner,
  requestJobSchedulePump,
} from '../../../session/job/job-offload';
import type { ToolStore } from '../../store';
import { pushJobInboxEvent } from './job-inbox';
import { listJobs, type JobRecord } from './job-ledger';
import type { JobKind, JobStatus } from './job-store-key';
import { emitJobEvents, inboxToWireEvent } from './job-emit';
import { reconcileStaleRunningJobs, resumeJobs } from './job-worker';
import {
  bindJobLedgerCrashMirror,
  mergeCrashMirrorIntoStore,
} from './job-crash-mirror';

export const SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV =
  'SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET';

/** Kinds that may auto-resume after an unexpected interrupt. */
const AUTO_RESUME_SAFE_KINDS: ReadonlySet<JobKind> = new Set([
  'task',
  'explore',
  'research',
  'implement',
  'verify',
  'mission',
  'desk',
  'goal-desk',
  'goal-driver',
]);

const HOLD_STATUSES: ReadonlySet<JobStatus> = new Set(['needs_user', 'blocked']);

export type JobRecoveryDisposition = 'resume' | 'hold';

export interface JobRecoveryResult {
  readonly reconciled: readonly JobRecord[];
  readonly resumed: readonly JobRecord[];
  readonly held: readonly JobRecord[];
  readonly autoResumeEnabled: boolean;
}

export function isAutoResumeFleetEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveConfigValue({
    env,
    envKey: SUPERLIORA_CONDUCTOR_AUTO_RESUME_FLEET_ENV,
    defaultValue: true,
    parseEnv: parseBooleanEnv,
  });
}

export function classifyJobForAutoResume(job: JobRecord): JobRecoveryDisposition {
  if (HOLD_STATUSES.has(job.status)) return 'hold';
  if (job.status !== 'interrupted') return 'hold';
  if (job.kind === 'merge' || job.kind === 'push') return 'hold';
  if (!AUTO_RESUME_SAFE_KINDS.has(job.kind)) return 'hold';
  return 'resume';
}

function holdReason(job: JobRecord): string {
  if (job.status === 'needs_user') return 'needs_user — answer via JobResume before continuing';
  if (job.status === 'blocked') return 'blocked — fix cause (JobInspect) before JobResume';
  if (job.kind === 'merge') return 'merge — confirm land manually (no blind re-merge)';
  if (job.kind === 'push') return 'push — confirm publish manually (no blind re-push)';
  return `held — status=${job.status} kind=${job.kind}`;
}

function pushRecoveryInbox(
  store: ToolStore,
  agent: Agent | undefined,
  input: {
    readonly kind: 'recovery.auto_resumed' | 'recovery.held' | 'recovery.reattach_failed';
    readonly job: JobRecord;
    readonly summary: string;
  },
): void {
  const event = pushJobInboxEvent(store, {
    kind: input.kind,
    jobId: input.job.id,
    status: input.job.status,
    title: input.job.title,
    summary: input.summary,
  });
  emitJobEvents(agent, [inboxToWireEvent(event)]);
}

/**
 * Reconcile stale running jobs, optionally auto-resume safe interrupted work.
 * Call from Agent.resume after wire replay (+ crash-mirror merge).
 */
export async function recoverJobsAfterResume(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
  /** Override pref/env; default follows {@link isAutoResumeFleetEnabled}. */
  readonly autoResume?: boolean;
}): Promise<JobRecoveryResult> {
  const { store, agent } = input;
  if (agent?.homedir) {
    bindJobLedgerCrashMirror(store, agent.homedir);
    mergeCrashMirrorIntoStore(store, agent.homedir);
  }

  const reconciled = reconcileStaleRunningJobs({
    store,
    agent,
    reason: 'process restarted',
  });

  const autoResumeEnabled = input.autoResume ?? isAutoResumeFleetEnabled();
  const interrupted = listJobs(store).filter(
    (j) =>
      j.status === 'interrupted' ||
      j.status === 'needs_user' ||
      j.status === 'blocked',
  );

  const toResume: JobRecord[] = [];
  const held: JobRecord[] = [];
  for (const job of interrupted) {
    if (!autoResumeEnabled) {
      if (job.status === 'interrupted') held.push(job);
      continue;
    }
    if (classifyJobForAutoResume(job) === 'resume') {
      toResume.push(job);
    } else if (
      job.status === 'interrupted' ||
      job.status === 'needs_user' ||
      job.status === 'blocked'
    ) {
      held.push(job);
    }
  }

  const resumed: JobRecord[] = [];
  if (autoResumeEnabled) {
    for (const job of toResume) {
      const result = await resumeJobs({ store, agent, jobId: job.id });
      if (result.ok && result.resumed.length > 0) {
        resumed.push(...result.resumed);
        const latest = result.resumed[0] ?? job;
        pushRecoveryInbox(store, agent, {
          kind: 'recovery.auto_resumed',
          job: latest,
          summary: 'fleet autopilot re-queued after crash/resume',
        });
      }
    }
    for (const job of held) {
      pushRecoveryInbox(store, agent, {
        kind: 'recovery.held',
        job,
        summary: holdReason(job),
      });
    }
  }

  // Resume with only blocked + already-queued work (no interrupted) used to
  // skip the pump entirely — Dock stayed on "Queued after resume…" forever.
  // Pump whenever anything is queued so free pool slots actually promote.
  if (agent !== undefined && listJobs(store).some((j) => j.status === 'queued')) {
    await requestJobSchedulePump({ store, agent });
    await getJobWorkerSpawner().settle();
  }

  return { reconciled, resumed, held, autoResumeEnabled };
}
