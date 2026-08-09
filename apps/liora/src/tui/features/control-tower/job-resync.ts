/**
 * Resync JobBoardStore from Session.jobList() (F18).
 */

import type { JobSnapshot } from '@superliora/protocol';

export interface JobResyncDesk {
  applySnapshots(jobs: readonly JobSnapshot[]): void;
  publishFromStore(): void;
}

export interface JobResyncHost {
  readonly controlTowerDesk?: JobResyncDesk;
  requireSession(): { jobList(): Promise<readonly JobSnapshot[]> };
}

/** Best-effort ledger pull; no-op when desk/session missing. */
export async function resyncJobBoardFromSession(host: JobResyncHost): Promise<boolean> {
  const desk = host.controlTowerDesk;
  if (desk === undefined) return false;
  try {
    const jobs = await host.requireSession().jobList();
    desk.applySnapshots(jobs);
    desk.publishFromStore();
    return true;
  } catch {
    return false;
  }
}
