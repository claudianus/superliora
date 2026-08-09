/**
 * F13 — surface interrupted Conductor jobs after session resume/startup.
 */

import type { Session } from '@superliora/sdk';
import { JOB_EVENT_SCHEMA_VERSION } from '@superliora/protocol';

import { isExperimentalFlagEnabled } from '../../commands/experimental-flags';
import type { ColorToken } from '../../theme';
import type { ControlTowerJobDesk } from './job-desk-events';

export interface InterruptedBannerHost {
  showStatus(msg: string, color?: ColorToken): void;
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  readonly controlTowerDesk?: ControlTowerJobDesk;
}

/** Query JobList, seed the desk store, then show the resume banner when needed. */
export async function maybeAnnounceInterruptedJobs(
  host: InterruptedBannerHost,
  session: Session,
): Promise<void> {
  if (!isExperimentalFlagEnabled('conductor_ux_v2')) return;
  if (typeof session.jobList !== 'function') return;
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
      desk.maybeShowInterruptedBanner(true);
      return;
    }
    const interrupted = jobs.filter((job) => job.status === 'interrupted').length;
    if (interrupted <= 0) return;
    const n = String(interrupted);
    host.showNotice?.(
      `${n} interrupted job${interrupted === 1 ? '' : 's'}`,
      '/job resume or open Inbox (Alt+I)',
      { coalesceKey: 'job-interrupted-banner' },
    );
    host.showStatus(
      `${n} interrupted jobs — /job resume or open Inbox (Alt+I)`,
      'warning',
    );
  } catch {
    // Best-effort: resume must not block on JobList.
  }
}
