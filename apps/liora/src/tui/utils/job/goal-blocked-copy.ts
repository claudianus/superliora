/**
 * Humanize Goal Monitor blocked reasons — especially model-spawn harness fails.
 * Pure copy helper; no SDK calls.
 */

export type GoalBlockedCopy = {
  readonly headline: string;
  readonly next?: string;
};

const MODEL_SPAWN_RE =
  /no live(?:-healthy)? worker model|failed live probe|worker model .+ (?:is unknown or unhealthy|failed live probe)|spawn_blocked:|model_failed:/i;

/**
 * Turn harness terminalReason into short monitor copy + an actionable next line.
 */
export function formatGoalBlockedCopy(terminalReason: string | undefined): GoalBlockedCopy {
  const raw = terminalReason?.trim() ?? '';
  if (raw.length === 0) {
    return { headline: 'blocked', next: '/goal status · Alt+J' };
  }

  if (MODEL_SPAWN_RE.test(raw)) {
    const tried = /tried ([^)—]+)/i.exec(raw)?.[1]?.trim();
    const headline =
      tried !== undefined && tried.length > 0
        ? `no live worker model (tried ${truncateList(tried, 42)})`
        : 'no live worker model for goal-driver';
    return {
      headline,
      next: '/model → live coding model · /goal resume',
    };
  }

  if (/goal worker missing from ledger/i.test(raw)) {
    return {
      headline: 'goal worker missing from ledger',
      next: '/goal resume · Alt+J',
    };
  }

  return { headline: raw, next: '/goal resume · Alt+J' };
}

function truncateList(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(8, max - 1))}…`;
}
