/**
 * Session Goal API facade for Conductor — synthesizes GoalSnapshot from the
 * Goal Desk binding + Job ledger (no main-lane GoalMode).
 */

import type { GoalChange, GoalSnapshot, GoalStatus, GoalToolResult } from '#/agent/goal/types';
import type { Agent } from '#/agent/index';
import type { ToolStore } from '../../store';

import { getJob } from '../job/job-ledger';
import { resumeJobs } from '../job/job-worker';
import {
  cancelBoundGoalJobs,
  healActiveGoalDeskBinding,
  listDeskGoalDrivers,
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

function aggregateDriverUsage(
  store: ToolStore | undefined,
  binding: GoalSessionBinding,
): { readonly turnsUsed: number; readonly tokensUsed: number } {
  if (store === undefined) {
    return { turnsUsed: 0, tokensUsed: 0 };
  }
  let turnsUsed = 0;
  let tokensUsed = 0;
  for (const id of binding.driverJobIds) {
    const job = getJob(store, id);
    if (job === undefined) continue;
    const progress = job.progress;
    if (progress?.stepsCompleted !== undefined) {
      turnsUsed += progress.stepsCompleted;
    }
    tokensUsed += (progress?.tokensIn ?? 0) + (progress?.tokensOut ?? 0);
  }
  return { turnsUsed, tokensUsed };
}

export function snapshotFromGoalDeskBinding(
  binding: GoalSessionBinding,
  store?: ToolStore,
): GoalSnapshot {
  const usage = aggregateDriverUsage(store, binding);
  return {
    goalId: binding.goalId,
    objective: binding.objective,
    completionCriterion: binding.completionCriterion,
    ...(binding.gateCommand !== undefined ? { gateCommand: binding.gateCommand } : {}),
    status: bindingStatusToGoalStatus(binding.status),
    turnsUsed: usage.turnsUsed,
    tokensUsed: usage.tokensUsed,
    // Wall clock stays 0 — TUI live-ticks from setGoal observation so progress
    // emits do not reset / double-count the Goal Monitor elapsed label.
    wallClockMs: 0,
    budget: EMPTY_BUDGET,
    terminalReason: binding.terminalReason,
    execution: 'goal-desk',
    deskJobId: binding.deskJobId,
  };
}

function emitGoalDeskUpdated(
  agent: Agent,
  snapshot: GoalSnapshot | null,
  change?: GoalChange,
): void {
  agent.emitEvent({
    type: 'goal.updated',
    snapshot,
    ...(change !== undefined ? { change } : {}),
  });
}

/** Rebuild + emit the session Goal view after driver progress / terminal sync. */
export function emitGoalDeskSnapshot(agent: Agent, store: ToolStore = agent.tools.toolStore): void {
  const raw = readGoalSessionBinding(store);
  if (raw === undefined) return;
  const binding = healActiveGoalDeskBinding(store, raw, agent);
  if (binding.status === 'cancelled') {
    emitGoalDeskUpdated(agent, null);
    return;
  }
  const snapshot = snapshotFromGoalDeskBinding(binding, store);
  if (binding.status === 'done') {
    emitGoalDeskUpdated(agent, snapshot, {
      kind: 'completion',
      status: 'complete',
      reason: binding.terminalReason,
      actor: 'runtime',
      stats: {
        turnsUsed: snapshot.turnsUsed,
        tokensUsed: snapshot.tokensUsed,
        wallClockMs: snapshot.wallClockMs,
      },
    });
    // Clear so Goal Monitor / footer drop after the completion card lands.
    emitGoalDeskUpdated(agent, null);
    return;
  }
  emitGoalDeskUpdated(agent, snapshot);
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
  const snapshot = snapshotFromGoalDeskBinding(result.binding, agent.tools.toolStore);
  emitGoalDeskUpdated(agent, snapshot, {
    kind: 'lifecycle',
    status: 'active',
    actor: 'user',
  });
  return snapshot;
}

export function conductorGetGoal(agent: Agent): GoalToolResult {
  const store = agent.tools.toolStore;
  const raw = readGoalSessionBinding(store);
  if (raw === undefined) return { goal: null };
  if (raw.status === 'cancelled' && raw.terminalReason === 'cancelled') {
    // Cleared after cancel — treat as no goal for UI.
    return { goal: null };
  }
  // Heal zombies / stuck blocked bindings, then refresh from the desk umbrella.
  // Skip re-blocking from a stale desk card when a driver is already productive.
  let next: GoalSessionBinding = healActiveGoalDeskBinding(store, raw, agent);
  const desk = getJob(store, next.deskJobId);
  const binding = next;
  const productiveDriver = listDeskGoalDrivers(store, binding).some(
    (job) => job.status === 'queued' || job.status === 'running',
  );
  if (desk?.status === 'needs_user' && !productiveDriver) {
    next = { ...binding, status: 'blocked', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'blocked' && !productiveDriver) {
    next = { ...binding, status: 'blocked', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'done') {
    next = { ...binding, status: 'done', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'failed' && !productiveDriver) {
    next = { ...binding, status: 'blocked', terminalReason: desk.resultSummary };
    writeGoalSessionBinding(store, next);
  } else if (desk?.status === 'interrupted' && !productiveDriver) {
    next = { ...binding, status: 'paused' };
    writeGoalSessionBinding(store, next);
  }
  if (next.status === 'done') {
    // complete is transient for classic goals; keep snapshot once for status.
    return { goal: snapshotFromGoalDeskBinding(next, store) };
  }
  if (next.status === 'cancelled') return { goal: null };
  return { goal: snapshotFromGoalDeskBinding(next, store) };
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
  const snapshot = snapshotFromGoalDeskBinding(next, store);
  emitGoalDeskUpdated(agent, snapshot, {
    kind: 'lifecycle',
    status: 'paused',
    reason: 'paused by user',
    actor: 'user',
  });
  return snapshot;
}

export async function conductorResumeGoal(agent: Agent): Promise<GoalSnapshot> {
  const store = agent.tools.toolStore;
  const binding = readGoalSessionBinding(store);
  if (binding === undefined) {
    throw new Error('No active goal.');
  }
  if (binding.status !== 'paused' && binding.status !== 'blocked') {
    return snapshotFromGoalDeskBinding(binding, store);
  }
  // Resume interrupted / blocked / failed / needs_user drivers. Model spawn
  // blocks land as `blocked` (older ledgers may still say `failed`).
  for (const id of [binding.deskJobId, ...binding.driverJobIds]) {
    const job = getJob(store, id);
    if (
      job?.status === 'interrupted' ||
      job?.status === 'blocked' ||
      job?.status === 'failed' ||
      job?.status === 'needs_user'
    ) {
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
  const snapshot = snapshotFromGoalDeskBinding(next, store);
  emitGoalDeskUpdated(agent, snapshot, {
    kind: 'lifecycle',
    status: 'active',
    reason: 'resumed',
    actor: 'user',
  });
  return snapshot;
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
  const snapshot = snapshotFromGoalDeskBinding(next, store);
  emitGoalDeskUpdated(agent, null, {
    kind: 'lifecycle',
    status: 'blocked',
    reason: 'cancelled',
    actor: 'user',
  });
  return snapshot;
}
