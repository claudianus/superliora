/**
 * Stale worktree hygiene notices after land / session end (F10).
 */

import { ttui } from '#/tui/utils/tui-i18n';

export interface HygieneNotice {
  readonly title: string;
  readonly detail: string;
}

/** When dry-run GC reports removable worktrees, nudge `/job gc`. */
export function formatHygieneGcNotice(staleCount: number): HygieneNotice | undefined {
  if (staleCount <= 0) return undefined;
  return {
    title:
      staleCount === 1
        ? ttui('tui.notice.jobHygieneStale.titleOne')
        : ttui('tui.notice.jobHygieneStale.titleMany', { count: String(staleCount) }),
    detail: ttui('tui.notice.jobHygieneStale.detail'),
  };
}

/** After applying GC, confirm how many worktrees were removed. */
export function formatHygieneGcAppliedNotice(removedCount: number): HygieneNotice | undefined {
  if (removedCount <= 0) return undefined;
  return {
    title:
      removedCount === 1
        ? ttui('tui.notice.jobHygieneRemoved.titleOne')
        : ttui('tui.notice.jobHygieneRemoved.titleMany', { count: String(removedCount) }),
    detail: ttui('tui.notice.jobHygieneRemoved.detail'),
  };
}
