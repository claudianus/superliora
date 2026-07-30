import { GOAL_FORK_CLEARED_REMINDER } from './goal-constants';
import type { GoalModeHost } from './goal-mode-host';
import { appendGoalStatusUpdate, persistGoalState } from './goal-persistence';
import { applyGoalStatus, goalStatsOf, toGoalSnapshot } from './goal-snapshot';
import type { AgentRecordOf } from '../records/types';
import type { GoalState } from './types';

/**
 * Reconciles replayed goal state with runtime reality on agent resume.
 *
 * An `active` goal cannot still be running after a process restart (goal
 * continuation only advances inside a live turn), so it is demoted to
 * `paused`, requiring `/goal resume` to restart work. `paused` and `blocked`
 * goals are preserved (both resumable). Any stray `complete` (which should
 * have been followed by `goal.clear`) is removed.
 */
export function normalizeGoalAfterReplay(host: GoalModeHost): void {
  const state = host.state;
  if (state === undefined) return;

  state.wallClockResumedAt = undefined;

  if (state.status === 'complete') {
    host.clearInternal('runtime', { emit: false, track: false });
    return;
  }

  if (state.status === 'active') {
    const reason = 'Paused after agent resume';
    applyGoalStatus(state, 'paused');
    state.terminalReason = reason;
    persistGoalState(host, state, { silent: true });
    appendGoalStatusUpdate(host, state, 'runtime', reason);
    return;
  }

  // `paused` and `blocked` goals are left intact (both resumable).
}

export function restoreGoalCreate(host: GoalModeHost, record: AgentRecordOf<'goal.create'>): void {
  const state: GoalState = {
    goalId: record.goalId,
    objective: record.objective,
    completionCriterion: record.completionCriterion,
    status: 'active',
    turnsUsed: 0,
    tokensUsed: 0,
    wallClockMs: 0,
    budgetLimits: {},
  };
  host.state = state;
  host.agent.replayBuilder.push({
    type: 'goal_updated',
    snapshot: toGoalSnapshot(state),
    change: { kind: 'created' },
  });
}

export function restoreGoalUpdate(host: GoalModeHost, record: AgentRecordOf<'goal.update'>): void {
  const state = host.state;
  if (state === undefined) return;

  const status = record.status;
  if (status !== undefined) {
    state.status = status;
    state.wallClockResumedAt = undefined;
    state.terminalReason = status === 'active' ? undefined : record.reason;
  }
  if (record.turnsUsed !== undefined) state.turnsUsed = record.turnsUsed;
  if (record.tokensUsed !== undefined) state.tokensUsed = record.tokensUsed;
  if (record.wallClockMs !== undefined) {
    state.wallClockMs = record.wallClockMs;
    state.wallClockResumedAt = undefined;
  }
  if (record.budgetLimits !== undefined) state.budgetLimits = record.budgetLimits;
  if (status === undefined) return;

  host.agent.replayBuilder.push({
    type: 'goal_updated',
    snapshot: toGoalSnapshot(state),
    change: status === 'complete'
      ? {
          kind: 'completion',
          status,
          reason: record.reason,
          stats: goalStatsOf(state),
          actor: record.actor,
        }
      : {
          kind: 'lifecycle',
          status,
          reason: record.reason,
          actor: record.actor,
        },
  });
}

export function restoreGoalClear(host: GoalModeHost, _record: AgentRecordOf<'goal.clear'>): void {
  host.state = undefined;
}

export function restoreGoalForked(host: GoalModeHost, _record: AgentRecordOf<'forked'>): void {
  const hadGoal = host.state !== undefined;
  host.state = undefined;
  if (!hadGoal) return;
  host.agent.context.appendSystemReminder(GOAL_FORK_CLEARED_REMINDER, {
    kind: 'system_trigger',
    name: 'goal_fork_cleared',
  });
}
