/**
 * Session Goal API facade for Conductor — synthesizes GoalSnapshot from the
 * Goal Desk binding + Job ledger (no main-lane GoalMode).
 */

import type { GoalSnapshot, GoalStatus, GoalToolResult } from '#/agent/goal/types';
import type { Agent } from '#/agent/index';

import { getJob } from '../job/job-ledger';
import { resumeJobs } from '../job/job-worker';
import {
  cancelBoundGoalJobs,
  readGoalSessionBinding,
  writeGoalSessionBinding,
  type GoalSessionBinding,
  type GoalSessionBindingStatus,
} from './goal-session-binding';
import { delegateConductorGoalDesk } from './goal-desk';

const EMPTY_BUDGET: GoalSnapshot['budget'] = {
  tokenBudget: null,
  turnBudget: null,
  wallClockBudgetMs: null,
  remainingTokens: null,
  remainingTurns: null,
  remainingWallClockMs: null,
  tokenBudgetReached: false,
  turnBudgetReached: false,
  wallClockBudgetReached: false,
  overBudget: false,
};

function bindingStatusToGoalStatus(status: GoalSessionBindingStatus): GoalStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'complete';
    case 'cancelled':
      return 'blocked';
    default:
      return 'active';
  }
}

export function snapshotFromGoalDeskBinding(binding: GoalSessionBinding): GoalSnapshot {
  return {
    goalId: binding.goalId,
    objective: binding.objective,
    completionCriterion: binding.completionCriterion,
    ...(binding.gateCommand !== undefined ? { gateCommand: binding.gateCommand } : {}),
    status: bindingStatusToGoalStatus(binding.status),
    turnsUsed: 0,
    tokensUsed: 0,
    wallClockMs: 0,
    budget: EMPTY_BUDGET,
    terminalReason: binding.terminalReason,
    execution: 'goal-desk',
    deskJobId: binding.deskJobId,
  };
}

export async function conductorCreateGoal(
  agent: Agent,
  input: {
    readonly objective: string;
    readonly replace?: boolean;
    readonly completionCriterion?: string;
    readonly gateCommand?: string;
  },
): Promise<GoalSnapshot> {
  const result = await delegateConductorGoalDesk(agent, {
    objective: input.objective,
    replace: input.replace,
    completionCriterion: input.completionCriterion,
    gateCommand: input.gateCommand,
  });
  return snapshotFromGoalDeskBinding(result.binding);
}

export function conductorGetGoal(agent: Agent): GoalToolResult {
  const binding = readGoalSessionBinding(agent.tools.toolStore);
  if (binding === undefined) return { goal: null };
  if (binding.status === 'cancelled' && binding.terminalReason === 'cancelled') {
    // Cleared after cancel — treat as no goal for UI.
    return { goal: null };
  }
  // Refresh status from live Jobs when still active.
  const store = agent.tools.toolStore;
  const desk = getJob(store, binding.deskJobId);
  let next: GoalSessionBinding = binding;
  if (desk?.status === 'needs_user') {
    next = { ...binding, status: 'blocked', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'blocked') {
    next = { ...binding, status: 'blocked', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'done') {
    next = { ...binding, status: 'done', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'failed') {
    next = { ...binding, status: 'blocked', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'interrupted') {
    next = { ...binding, status: 'paused' };
    writeGoalSessionBinding(store, next);
  }
  if (next.status === 'done') {
    // complete is transient for classic goals; keep snapshot once for status.
    return { goal: snapshotFromGoalDeskBinding(next) };
  }
  if (next.status === 'cancelled') return { goal: null };
  return { goal: snapshotFromGoalDeskBinding(next) };
}

export function conductorPauseGoal(agent: Agent): GoalSnapshot {
  const store = agent.tools.toolStore;
  const binding = readGoalSessionBinding(store);
  if (binding === undefined) {
    throw new Error('No active goal.');
  }
  cancelBoundGoalJobs(store, binding, 'pause', agent);
  const next: GoalSessionBinding = {
    ...binding,
    status: 'paused',
    terminalReason: 'paused by user',
    updatedAt: new Date().toISOString(),
  };
  writeGoalSessionBinding(store, next);
  return snapshotFromGoalDeskBinding(next);
}

export async function conductorResumeGoal(agent: Agent): Promise<GoalSnapshot> {
  const store = agent.tools.toolStore;
  const binding = readGoalSessionBinding(store);
  if (binding === undefined) {
    throw new Error('No active goal.');
  }
  if (binding.status !== 'paused' && binding.status !== 'blocked') {
    return snapshotFromGoalDeskBinding(binding);
  }
  // Resume interrupted drivers (and desk umbrella status).
  for (const id of [binding.deskJobId, ...binding.driverJobIds]) {
    const job = getJob(store, id);
    if (job?.status === 'interrupted' || job?.status === 'blocked') {
      await resumeJobs({ store, agent, jobId: id });
    }
  }
  const next: GoalSessionBinding = {
    ...binding,
    status: 'active',
    terminalReason: undefined,
    updatedAt: new Date().toISOString(),
  };
  writeGoalSessionBinding(store, next);
  return snapshotFromGoalDeskBinding(next);
}

export function conductorCancelGoal(agent: Agent): GoalSnapshot {
  const store = agent.tools.toolStore;
  const binding = readGoalSessionBinding(store);
  if (binding === undefined) {
    throw new Error('No active goal.');
  }
  cancelBoundGoalJobs(store, binding, 'cancel', agent);
  const next: GoalSessionBinding = {
    ...binding,
    status: 'cancelled',
    terminalReason: 'cancelled',
    updatedAt: new Date().toISOString(),
  };
  writeGoalSessionBinding(store, next);
  return snapshotFromGoalDeskBinding(next);
}
