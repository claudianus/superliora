/**
 * Goal driver helpers — extracted from TurnFlow.
 *
 * Contains the goal continuation prompt, origin tag, progress-signature
 * builder, and goal-outcome reminder detection used by the goal drive loop.
 */

import type { Agent } from '..';
import type { PromptOrigin } from '../context';
import {
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
} from './reminder-names';

export {
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
};

/** Origin tag for the synthetic "continue" prompt that drives each goal turn. */
export const GOAL_CONTINUATION_ORIGIN: PromptOrigin = { kind: 'system_trigger', name: 'goal_continuation' };

/**
 * The prompt the goal driver appends to start each continuation turn — the
 * autonomous stand-in for the user typing "continue". The model decides when to
 * stop by calling `UpdateGoal`; otherwise the driver runs another turn.
 */
export const GOAL_CONTINUATION_PROMPT = [
  'Continue. Pick the next highest-impact action toward the goal and execute it now.',
  'Use TodoList to track progress — mark items done as you complete them, add new items as work emerges.',
  'Do not re-explore or re-plan what is already decided; act on the current state.',
  'Make reasonable decisions autonomously. Do not ask the user unless a decision materially changes direction and cannot be inferred from context.',
  'Mark `complete` only when all required work is done and validated (tests pass, build clean).',
  'Mark `blocked` only when a real external condition prevents progress.',
  'Otherwise keep going.',
].join(' ');

/**
 * Builds a compact progress signature for the no-progress detector.
 * Combines goal state + ultrawork WorkGraph node status into a single
 * string that changes when material progress is made.
 */
export function buildGoalProgressSignature(agent: Agent): string {
  const goal = agent.goal.getGoal().goal;
  const run = agent.ultrawork?.getRun() ?? null;
  const parts: string[] = [
    `goal:${goal?.goalId ?? 'none'}:${goal?.status ?? 'none'}:${goal?.turnsUsed ?? 0}`,
  ];
  if (run === null || run.workGraph === undefined) {
    parts.push('uw:none');
    return parts.join('|');
  }
  const nodes = run.workGraph.nodes;
  const open = nodes.filter((n) => n.status !== 'done' && n.status !== 'failed').map((n) => n.id);
  const done = nodes.filter((n) => n.status === 'done').length;
  const evidence = nodes.reduce((acc, n) => acc + (n.evidenceIds?.length ?? 0), 0);
  parts.push(`uw:${run.id}:${run.status}:done=${done}:open=${open.slice(0, 12).join(',')}:ev=${evidence}`);
  return parts.join('|');
}

/** Returns true if the origin is a goal completion/blocked reminder injection. */
export function isGoalOutcomeReminderOrigin(origin: PromptOrigin | undefined): boolean {
  return (
    origin?.kind === 'system_trigger' &&
    (origin.name === GOAL_COMPLETION_REMINDER_NAME ||
      origin.name === GOAL_BLOCKED_REMINDER_NAME)
  );
}

/** Returns true if the step budget allows another step. */
export function hasStepBudgetRemaining(maxSteps: number | undefined, currentStep: number): boolean {
  return maxSteps === undefined || maxSteps <= 0 || currentStep < maxSteps;
}
