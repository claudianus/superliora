/**
 * Stale worktree hygiene after land / session end (F10).
 * Applies conductor job GC (done leftovers + fail TTL); does not only announce.
 */

import type { ColorToken } from '../../theme';
import { formatHygieneGcAppliedNotice } from '../../utils/job/job-hygiene-notice';

export interface JobHygieneHost {
  readonly session?: {
    jobGcWorktrees(input?: {
      readonly dryRun?: boolean;
    }): Promise<{ readonly removed: number; readonly kept: number }>;
  };
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  showStatus?(msg: string, color?: ColorToken): void;
}

/**
 * Apply job worktree GC. When anything was removed, show a short notice.
 * Disk cleanup is not gated on conductor_ux_v2.
 */
export async function maybeApplyStaleWorktrees(host: JobHygieneHost): Promise<void> {
  const session = host.session;
  if (session === undefined) return;
  try {
    const result = await session.jobGcWorktrees({ dryRun: false });
    const notice = formatHygieneGcAppliedNotice(result.removed);
    if (notice === undefined) return;
    host.showNotice?.(notice.title, notice.detail, { coalesceKey: 'job-hygiene-gc' });
    host.showStatus?.(notice.title, 'info');
  } catch {
    /* best-effort */
  }
}

/** @deprecated Prefer {@link maybeApplyStaleWorktrees}; kept for call-site migration. */
export async function maybeAnnounceStaleWorktrees(host: JobHygieneHost): Promise<void> {
  return maybeApplyStaleWorktrees(host);
}
