/**
 * Goal Desk — Conductor `/goal` offload (Plan Desk symmetric).
 *
 * Creates a ledger umbrella (`kind=goal-desk`, no LLM worker in v1) plus a
 * child `goal-driver` Job that owns the autonomous loop in a worktree.
 */

import { randomUUID } from 'node:crypto';

import type { Agent } from '#/agent/index';
import { ErrorCodes, LioraError } from '#/errors/index';
import { SOVEREIGN_CONDUCTOR_PROFILE_NAME } from '#/profile/main-profile';

import {
  JOB_CREATE_ACK_SPAWN_GRACE_MS,
  getJobWorkerSpawner,
  requestJobSchedulePump,
} from '../../../session/job/job-offload';
import { createJob, getJob, type JobRecord } from '../job/job-ledger';
import {
  cancelBoundGoalJobs,
  readGoalSessionBinding,
  resolveCompletionCriterion,
  writeGoalSessionBinding,
  type GoalSessionBinding,
} from './goal-session-binding';

export interface GoalDeskDelegateInput {
  readonly objective: string;
  readonly completionCriterion?: string;
  /** Shell gate for the goal-driver worker (Prime autonomous-gate). */
  readonly gateCommand?: string;
  readonly replace?: boolean;
  readonly title?: string;
}

export interface GoalDeskDelegateResult {
  readonly desk: JobRecord;
  readonly driver: JobRecord;
  readonly binding: GoalSessionBinding;
  readonly output: string;
}

export function shouldDelegateGoalToDesk(agent: Agent): boolean {
  return agent.type === 'main' && agent.config.profileName === SOVEREIGN_CONDUCTOR_PROFILE_NAME;
}

/**
 * Create Goal Desk umbrella + goal-driver child; bind for session Goal API.
 */
export async function delegateConductorGoalDesk(
  agent: Agent,
  input: GoalDeskDelegateInput,
): Promise<GoalDeskDelegateResult> {
  const objective = input.objective.trim();
  if (objective.length === 0) {
    throw new LioraError(ErrorCodes.GOAL_OBJECTIVE_EMPTY, 'Goal objective cannot be empty');
  }
  const criterion = resolveCompletionCriterion(objective, input.completionCriterion);
  const store = agent.tools.toolStore;

  if (input.replace === true) {
    const existing = readGoalSessionBinding(store);
    if (
      existing !== undefined &&
      (existing.status === 'active' || existing.status === 'paused' || existing.status === 'blocked')
    ) {
      cancelBoundGoalJobs(store, existing, 'replaced', agent);
    }
  } else {
    const existing = readGoalSessionBinding(store);
    if (
      existing !== undefined &&
      (existing.status === 'active' || existing.status === 'paused' || existing.status === 'blocked')
    ) {
      throw new LioraError(
        ErrorCodes.GOAL_ALREADY_EXISTS,
        'A goal already exists; use replace to start a new one',
      );
    }
  }

  const title = (input.title?.trim() || titleFromObjective(objective)).slice(0, 120);
  const deskPrompt = buildGoalDeskBrief(objective, criterion);

  const desk = createJob(store, {
    title: `Goal Desk: ${title}`.slice(0, 120),
    kind: 'goal-desk',
    priority: 12,
    prompt: deskPrompt,
  });

  const gateCommand = input.gateCommand?.trim() || undefined;
  const driver = createJob(store, {
    title: `Goal: ${title}`.slice(0, 120),
    kind: 'goal-driver',
    priority: 11,
    prompt: objective,
    parentJobId: desk.id,
    goalObjective: objective,
    goalCompletionCriterion: criterion,
    ...(gateCommand !== undefined ? { goalGateCommand: gateCommand } : {}),
    successCriteria: [criterion],
    ...(gateCommand !== undefined ? { verificationCommands: [gateCommand] } : {}),
  });

  const binding: GoalSessionBinding = {
    schemaVersion: 1,
    goalId: `goal_desk_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    deskJobId: desk.id,
    objective,
    completionCriterion: criterion,
    ...(gateCommand !== undefined ? { gateCommand } : {}),
    driverJobIds: [driver.id],
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
  writeGoalSessionBinding(store, binding);

  requestJobSchedulePump({ store, agent });
  if (agent.subagentHost !== undefined) {
    await Promise.race([
      getJobWorkerSpawner().settle(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, JOB_CREATE_ACK_SPAWN_GRACE_MS);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  }

  const latestDesk = getJob(store, desk.id) ?? desk;
  const latestDriver = getJob(store, driver.id) ?? driver;
  const lines = [
    'Goal Desk: delegated off the Conductor lane (main does not run the goal loop).',
    `ACK desk ${latestDesk.id} state=${latestDesk.status}`,
    `ACK driver ${latestDriver.id} state=${latestDriver.status}`,
    `criterion: ${criterion}`,
    'Stay on the interactive lane: JobInbox / JobSteer / /goal status|pause|resume|cancel.',
  ];

  return {
    desk: latestDesk,
    driver: latestDriver,
    binding,
    output: lines.join('\n'),
  };
}

function titleFromObjective(objective: string): string {
  const one = objective.replace(/\s+/g, ' ').trim();
  if (one.length <= 72) return one;
  return `${one.slice(0, 64)}...`;
}

export function buildGoalDeskBrief(objective: string, criterion: string): string {
  return [
    'You are a Goal Desk umbrella Job (v1: ledger orchestration; driver already spawned).',
    'Do not implement product code. A child goal-driver was created with parent_job_id pointing here.',
    `Objective:\n${objective}`,
    `Completion criterion:\n${criterion}`,
    'When the driver finishes, your Job status mirrors the driver. Conductor reads the session binding.',
    'Large greenfield / vague Seed work: escalate to Conductor (needs_user) asking for Plan Desk first — do not plan inline.',
  ].join('\n\n');
}
