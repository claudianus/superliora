/**
 * Stale worktree hygiene notices after land / session end (F10).
 */

import { isExperimentalFlagEnabled } from '../../commands/experimental-flags';
import type { ColorToken } from '../../theme';
import { formatHygieneGcNotice } from '../../utils/job/job-hygiene-notice';

export interface JobHygieneHost {
  readonly session?: {
    jobGcWorktrees(input?: {
      readonly dryRun?: boolean;
    }): Promise<{ readonly removed: number; readonly kept: number }>;
  };
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  showStatus?(msg: string, color?: ColorToken): void;
}

/** Dry-run GC; when removable > 0, notice `/job gc`. */
export async function maybeAnnounceStaleWorktrees(host: JobHygieneHost): Promise<void> {
  if (!isExperimentalFlagEnabled('conductor_ux_v2')) return;
  const session = host.session;
  if (session === undefined || host.showNotice === undefined) return;
  try {
    const result = await session.jobGcWorktrees({ dryRun: true });
    const notice = formatHygieneGcNotice(result.removed);
    if (notice === undefined) return;
    host.showNotice(notice.title, notice.detail, { coalesceKey: 'job-hygiene-gc' });
    host.showStatus?.(notice.detail, 'info');
  } catch {
    /* best-effort */
  }
}
