import type { GoalSnapshot } from '@superliora/sdk';

import type { AppState } from '#/tui/types';
import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';

/** Footer `xp` micro-badge lifetime after goal progress ticks. */
export const GOAL_XP_PULSE_BADGE_TTL_MS = 2_000;

/** True when the same goal shows higher turn/token usage (evidence/todo progress). */
export function shouldGoalXpPulse(
  prev: GoalSnapshot | null | undefined,
  next: GoalSnapshot | null | undefined,
): boolean {
  if (next === null || next === undefined || next.status === 'complete') return false;
  if (prev === null || prev === undefined || prev.goalId !== next.goalId) return false;
  return next.turnsUsed > prev.turnsUsed || next.tokensUsed > prev.tokensUsed;
}

/** Dopamine Ops footer glance — brief `xp` badge after meaningful goal progress. */
export function formatGoalXpPulseFooterBadge(
  pulse: AppState['goalXpPulse'],
  nowMs: number = Date.now(),
): FooterBadge | null {
  if (pulse === undefined || pulse === null) return null;
  if (nowMs - pulse.atMs >= GOAL_XP_PULSE_BADGE_TTL_MS) return null;
  return { text: 'xp', severity: 'info' };
}
