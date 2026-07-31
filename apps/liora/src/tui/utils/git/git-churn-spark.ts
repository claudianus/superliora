import type { AppState } from '#/tui/types';
import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';

/** Footer `diff↑` micro-badge lifetime after git file churn. */
export const GIT_CHURN_BADGE_TTL_MS = 2_000;

export interface GitChurnSpark {
  readonly atMs: number;
  readonly count: number;
}

/** Last seen changed-file count per workDir (Ops 2s refresh ticks). */
const lastChangedCountByWorkDir = new Map<string, number>();

/** Reset module cache — tests only. */
export function resetGitChurnSparkCache(): void {
  lastChangedCountByWorkDir.clear();
}

/**
 * Dirty git with more changed files than the previous Ops tick → spark.
 * First tick per workDir only seeds the baseline.
 */
export function tickGitChurnSpark(
  workDir: string,
  dirty: boolean,
  changedFilesCount: number,
  nowMs: number = Date.now(),
): GitChurnSpark | null {
  const prev = lastChangedCountByWorkDir.get(workDir);
  lastChangedCountByWorkDir.set(workDir, changedFilesCount);
  if (!dirty || prev === undefined || changedFilesCount <= prev) return null;
  return { atMs: nowMs, count: changedFilesCount - prev };
}

/** Ops git pane glance for the refresh that detected churn. */
export function formatGitChurnOpsLine(spark: GitChurnSpark | null | undefined): string | null {
  if (spark == null || spark.count <= 0) return null;
  return `churn +${String(spark.count)}`;
}

/** Dopamine Ops footer glance — brief `diff↑` badge after git churn. */
export function formatGitChurnFooterBadge(
  churn: AppState['gitChurn'],
  nowMs: number = Date.now(),
): FooterBadge | null {
  if (churn === undefined || churn === null) return null;
  if (nowMs - churn.atMs >= GIT_CHURN_BADGE_TTL_MS) return null;
  return { text: 'diff↑', severity: 'info' };
}
