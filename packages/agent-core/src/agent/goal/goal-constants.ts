/**
 * After a false-complete rejection, further `markComplete` attempts are rejected
 * with `reject_cooldown` until this many goal turns have elapsed (AC-A3).
 */
export const GOAL_COMPLETE_REJECT_COOLDOWN_TURNS = 3;

/**
 * Consecutive goal turns with an unchanged progress signature before the
 * driver injects a no-progress reminder (AC-C1).
 */
export const GOAL_NO_PROGRESS_STREAK_K = 6;

/**
 * Loop31a — stable wire `warning.code` / injection variant for goal no-progress.
 * TUI matches this (and the `GOAL_NO_PROGRESS:` message prefix).
 */
export const GOAL_NO_PROGRESS_SENSOR_ORIGIN = 'goal-no-progress-sensor' as const;

/** Model + operator-visible tip when progress signature stalls for K turns. */
export function formatGoalNoProgressTip(
  streak: number,
  threshold: number = GOAL_NO_PROGRESS_STREAK_K,
  progressSignature?: string,
): string {
  const sig =
    progressSignature !== undefined && progressSignature.length > 0
      ? ` Signature: ${progressSignature}.`
      : '';
  return (
    `GOAL_NO_PROGRESS: No material progress for ${String(streak)} consecutive goal turns ` +
    `(threshold K=${String(threshold)}).${sig} Change approach, re-verify, or UpdateGoal(blocked).`
  );
}

export const GOAL_CANCELLED_REMINDER = [
  'The user cancelled the current goal.',
  'Ignore earlier active-goal reminders for that goal.',
  'Handle the next user request normally unless the user starts or resumes a goal.',
].join(' ');

export const GOAL_FORK_CLEARED_REMINDER = [
  'This fork does not have a current goal.',
  'Ignore earlier active-goal reminders from the source session.',
  'Handle requests normally unless the user starts a new goal.',
].join(' ');
