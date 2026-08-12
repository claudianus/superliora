/**
 * Goal driver helpers — extracted from TurnFlow.
 *
 * Contains the goal continuation prompt, origin tag, progress-signature
 * builder, and goal-outcome reminder detection used by the goal drive loop.
 */

import type { Agent } from '..';
import type { PromptOrigin } from '../context';
import {
  TODO_STORE_KEY,
  type TodoItem,
} from '../../tools/builtin/state/todo-list-store-key';
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
 * Compact TodoList fingerprint for the no-progress detector.
 * Status/title only — order-stable join so mark-done / rewrites change the sig.
 */
export function fingerprintGoalTodos(todos: readonly TodoItem[]): string {
  if (todos.length === 0) return '0';
  return todos
    .map((item) => `${item.status[0] ?? '?'}:${item.title.trim()}`)
    .join('|')
    .slice(0, 240);
}

/**
 * Builds a compact progress signature for the no-progress detector.
 * Changes only when material goal progress is made — never on turn counters
 * (`turnsUsed` / wall-clock), which always advance and used to zero the streak.
 */
export function buildGoalProgressSignature(agent: Agent): string {
  const goal = agent.goal.getGoal().goal;
  if (goal === null) return 'goal:none';
  let todoFp = '0';
  try {
    const todos = agent.tools.getStore().get(TODO_STORE_KEY) ?? [];
    todoFp = fingerprintGoalTodos(todos);
  } catch {
    // Tool store may be unavailable in unit fixtures — treat as empty board.
  }
  const criterion = goal.completionCriterion?.trim() ?? '';
  return `goal:${goal.goalId}:${goal.status}:todo:${todoFp}:crit:${criterion.slice(0, 64)}`;
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
