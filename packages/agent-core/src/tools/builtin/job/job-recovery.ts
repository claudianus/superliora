import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import { emitJobEvents, inboxToWireEvent } from './job-emit';
import { pushJobInboxEvent } from './job-inbox';
import { listJobs, type JobRecord } from './job-ledger';
import { reconcileStaleRunningJobs } from './job-worker';
import { bindJobLedgerCrashMirror, mergeCrashMirrorIntoStore } from './job-crash-mirror';

export interface JobRecoveryResult {
  readonly reconciled: readonly JobRecord[];
  readonly held: readonly JobRecord[];
}

/** Restore durable facts without starting or continuing model work. */
export async function recoverJobsAfterResume(input: {
  readonly store: ToolStore;
  readonly agent?: Agent;
}): Promise<JobRecoveryResult> {
  const { store, agent } = input;
  if (agent?.homedir) {
    bindJobLedgerCrashMirror(store, agent.homedir);
    mergeCrashMirrorIntoStore(store, agent.homedir);
  }
  const reconciled = reconcileStaleRunningJobs({ store, agent, reason: 'process restarted' });
  const held = listJobs(store).filter((job) =>
    job.status === 'interrupted' || job.status === 'needs_user' || job.status === 'blocked' || job.status === 'queued',
  );
  for (const job of held) {
    const event = pushJobInboxEvent(store, {
      kind: 'recovery.held',
      jobId: job.id,
      status: job.status,
      title: job.title,
      summary: `Recovered ${job.status} Job; no work was started during recovery. Use /job resume to continue.`,
    });
    emitJobEvents(agent, [inboxToWireEvent(event)]);
  }
  return { reconciled, held };
}
