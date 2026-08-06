import { computeBudgetReport, liveWallClockMs } from './budget';
import type { GoalChangeStats, GoalSnapshot, GoalState, GoalStatus } from './types';

export function normalizeCompletionCriterion(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : undefined;
}

export function applyGoalStatus(state: GoalState, status: GoalStatus, now: number = Date.now()): void {
  // Fold the live wall-clock interval into the running total when leaving
  // `active`, and anchor a fresh interval when entering it, so `wallClockMs`
  // stays a correct, persistable total across pause/resume/complete.
  if (state.status === 'active' && state.wallClockResumedAt !== undefined) {
    state.wallClockMs += Math.max(0, now - state.wallClockResumedAt);
    state.wallClockResumedAt = undefined;
  }
  if (status === 'active') {
    state.wallClockResumedAt = now;
  }
  state.status = status;
}

/** Counter snapshot for a {@link GoalChange}. */
export function goalStatsOf(state: GoalState, now: number = Date.now()): GoalChangeStats {
  return {
    turnsUsed: state.turnsUsed,
    tokensUsed: state.tokensUsed,
    wallClockMs: liveWallClockMs(state, now),
  };
}

export function toGoalSnapshot(state: GoalState, now: number = Date.now()): GoalSnapshot {
  return {
    goalId: state.goalId,
    objective: state.objective,
    completionCriterion: state.completionCriterion,
    ...(state.gateCommand !== undefined ? { gateCommand: state.gateCommand } : {}),
    status: state.status,
    turnsUsed: state.turnsUsed,
    tokensUsed: state.tokensUsed,
    wallClockMs: liveWallClockMs(state, now),
    budget: computeBudgetReport(state, now),
    terminalReason: state.terminalReason,
  };
}
