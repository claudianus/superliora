/**
 * Stale worktree hygiene notices after land / session end (F10).
 */

export interface HygieneNotice {
  readonly title: string;
  readonly detail: string;
}

/** When dry-run GC reports removable worktrees, nudge `/job gc`. */
export function formatHygieneGcNotice(staleCount: number): HygieneNotice | undefined {
  if (staleCount <= 0) return undefined;
  const n = String(staleCount);
  return {
    title: `${n} stale job worktree${staleCount === 1 ? '' : 's'}`,
    detail: 'Run /job gc to clean up landed worktrees.',
  };
}

/** After applying GC, confirm how many worktrees were removed. */
export function formatHygieneGcAppliedNotice(removedCount: number): HygieneNotice | undefined {
  if (removedCount <= 0) return undefined;
  const n = String(removedCount);
  return {
    title: `Removed ${n} stale job worktree${removedCount === 1 ? '' : 's'}`,
    detail: 'Landed and expired job worktrees were cleaned up.',
  };
}
