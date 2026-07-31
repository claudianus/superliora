import type { GoalSnapshot } from '@superliora/sdk';

import type { AppState } from '#/tui/types';

/** Compact Ops Goal pane — soft fallback when live counters are absent. */
export const OPS_GOAL_XP_SOFT_TIP =
  'XP: turns/tokens track goal progress (evidence/todo ticks)';

export interface GoalXpOpsGlance {
  readonly turnsUsed?: number;
  readonly tokensUsed?: number;
  readonly evidenceCount?: number;
  /** Local progress ticks when contextOS evidence pages are not wired. */
  readonly xpPulseCount?: number;
}

export interface GoalXpOpsGlanceInput {
  readonly goal?: GoalSnapshot | null;
  readonly appState?: Pick<AppState, 'goalEvidenceCount' | 'contextOS'>;
  readonly statusContextOS?: AppState['contextOS'];
}

/** Resolve live Goal XP / evidence counters from goal snapshot, AppState, or status. */
export function resolveGoalXpOpsGlance(input: GoalXpOpsGlanceInput): GoalXpOpsGlance | null {
  const { goal, appState, statusContextOS } = input;
  const contextOS = statusContextOS ?? appState?.contextOS ?? null;
  const turnsUsed = goal?.turnsUsed;
  const tokensUsed = goal?.tokensUsed;
  const evidenceCount = resolveGoalEvidenceCount(contextOS, appState?.goalEvidenceCount);
  const xpPulseCount =
    typeof appState?.goalEvidenceCount === 'number' && appState.goalEvidenceCount > 0
      ? appState.goalEvidenceCount
      : undefined;

  if (
    turnsUsed === undefined &&
    tokensUsed === undefined &&
    evidenceCount === undefined &&
    xpPulseCount === undefined
  ) {
    return null;
  }

  return {
    ...(typeof turnsUsed === 'number' ? { turnsUsed } : {}),
    ...(typeof tokensUsed === 'number' ? { tokensUsed } : {}),
    ...(typeof evidenceCount === 'number' ? { evidenceCount } : {}),
    ...(typeof xpPulseCount === 'number' ? { xpPulseCount } : {}),
  };
}

function resolveGoalEvidenceCount(
  contextOS: AppState['contextOS'] | null | undefined,
  goalEvidenceCount: number | undefined,
): number | undefined {
  if (contextOS != null && contextOS.pageCount > 0) {
    return contextOS.readyPageCount;
  }
  if (typeof goalEvidenceCount === 'number' && goalEvidenceCount > 0) {
    return goalEvidenceCount;
  }
  return undefined;
}

/** Ops Goal pane line — live counters when wired; else soft tip. */
export function formatGoalXpOpsLine(glance: GoalXpOpsGlance | null | undefined): string {
  if (glance == null) return OPS_GOAL_XP_SOFT_TIP;

  const turns = glance.turnsUsed;
  const evidence = glance.evidenceCount;
  if (typeof turns === 'number' && turns > 0) {
    const evidencePart =
      typeof evidence === 'number' && evidence > 0 ? ` · ${String(evidence)} evidence` : '';
    return `XP: ${String(turns)} turns${evidencePart}`;
  }

  if (typeof evidence === 'number' && evidence > 0) {
    return `Evidence: ${String(evidence)} ready`;
  }

  const pulseCount = glance.xpPulseCount;
  if (typeof pulseCount === 'number' && pulseCount > 0) {
    return `XP: ${String(pulseCount)} progress ticks`;
  }

  return OPS_GOAL_XP_SOFT_TIP;
}
