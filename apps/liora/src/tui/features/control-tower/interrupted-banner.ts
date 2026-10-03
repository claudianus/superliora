/**
 * Surface recorded interrupted Jobs after session resume/startup.
 * Interrupted work stays paused until the operator explicitly resumes it.
 */

import type { Session } from '@superliora/sdk';
import { JOB_EVENT_SCHEMA_VERSION, type JobSnapshot } from '@superliora/protocol';

import type { ColorToken } from '../../theme';
import type { ControlTowerJobDesk } from './job-desk-events';
import type { WorkerDockController } from '../../controllers/worker-dock/controller';

export interface InterruptedBannerHost {
  showStatus(msg: string, color?: ColorToken): void;
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  readonly controlTowerDesk?: ControlTowerJobDesk;
  readonly workerDock?: WorkerDockController;
}


/** Query JobList, seed the desk store, hydrate dock ghosts, announce recovery. */
export async function maybeAnnounceInterruptedJobs(
  host: InterruptedBannerHost,
  session: Session,
): Promise<void> {
  try {
    const jobs = await session.jobList();
    const desk = host.controlTowerDesk;
    if (desk !== undefined) {
      for (const job of jobs) {
        desk.store.applyJobUpdated({
          type: 'job.updated',
          schemaVersion: JOB_EVENT_SCHEMA_VERSION,
          job,
        });
      }
      desk.publishFromStore();
      host.workerDock?.hydrateGhostsFromJobs(desk.store.snapshot());
      announceRecovery(host, jobs);
      return;
    }
    announceRecovery(host, jobs);
  } catch {
    // Best-effort: resume must not block on JobList.
  }
}

function announceRecovery(
  host: InterruptedBannerHost,
  jobs: readonly JobSnapshot[],
): void {
  const interrupted = jobs.filter((job) => job.status === 'interrupted');
  if (interrupted.length === 0) return;


  const n = interrupted.length;
  host.showNotice?.(
    `${String(n)} interrupted job${n === 1 ? '' : 's'}`,
    '/job resume or open Inbox (Alt+I)',
    { coalesceKey: 'job-interrupted-banner' },
  );
  host.showStatus(
    `${String(n)} interrupted jobs — /job resume or open Inbox (Alt+I)`,
    'warning',
  );
}
