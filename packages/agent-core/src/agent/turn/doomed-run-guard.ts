/**
 * Doomed-run early exit (E4). Unattended subagent runs (Conductor workers,
 * swarms) used to have a single wall-clock deadline; a run that keeps failing
 * with varied arguments (never tripping the identical-signature doom-loop or
 * per-tool circuit breakers) burned its whole budget. This guard watches the
 * trailing tool-error streak: warn once, then force-stop the turn.
 */

import type { ContextMessage } from '../context';

/** Soft warn once the trailing tool-error streak reaches this length. */
export const DOOMED_RUN_WARN_STREAK = 10;
/** Hard-stop the turn once the streak reaches this length. */
export const DOOMED_RUN_HARD_STOP_STREAK = 16;
/** Origin variant of the one-shot warn reminder (dedupe across steps). */
export const DOOMED_RUN_WARN_ORIGIN = 'doomed_run_warn' as const;

/** Backward scan cap so the streak check never walks a whole long session. */
const DOOMED_RUN_SCAN_MAX_MESSAGES = 80;

/**
 * Count consecutive trailing `isError` tool results. Non-tool messages are
 * skipped; the first successful tool result (or the scan cap) ends the walk.
 */
export function trailingToolErrorStreak(history: readonly ContextMessage[]): number {
  let streak = 0;
  let scanned = 0;
  for (let i = history.length - 1; i >= 0 && scanned < DOOMED_RUN_SCAN_MAX_MESSAGES; i -= 1) {
    const message = history[i];
    scanned += 1;
    if (message?.role !== 'tool') continue;
    if (message.isError === true) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

/** True when the one-shot doomed-run warn reminder is already in context. */
export function hasDoomedRunWarnReminder(history: readonly ContextMessage[]): boolean {
  return history.some(
    (message) =>
      message.origin?.kind === 'injection' && message.origin.variant === DOOMED_RUN_WARN_ORIGIN,
  );
}

export function formatDoomedRunWarnTip(streak: number): string {
  return (
    `DOOMED_RUN_WARN: ${String(streak)} consecutive tool calls failed with no successful result in between. ` +
    'The current approach is not working. Stop retrying variations of it: try one materially different approach once, ' +
    'or finish now with a short failure summary (what was attempted, why it failed, recommended next step) instead of ' +
    `burning the remaining budget. A hard stop fires at ${String(DOOMED_RUN_HARD_STOP_STREAK)} consecutive failures.`
  );
}
