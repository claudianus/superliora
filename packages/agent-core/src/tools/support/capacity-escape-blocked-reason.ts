/**
 * Detect UpdateGoal(blocked|paused) reasons that stall the loop for magnitude /
 * calendar / scope-escape instead of a concrete external blocker or honest yield.
 *
 * ponytail: free-text heuristic. False positives return a tool error (model
 * continues); false negatives are the real risk, so patterns target the
 * documented escape phrasing.
 */

export const CAPACITY_ESCAPE_BLOCKED_MESSAGE =
  'UpdateGoal `blocked` rejected: reason looks like magnitude/calendar/scope escape, not a concrete external blocker. Continue with the next verifiable slice. Call UpdateGoal `blocked` only with evidence of a real external stop (missing credentials/approvals, permission deny, no write access, unreachable externals, contradictory goals). Do not rephrase the same escape.';

export const CAPACITY_ESCAPE_PAUSED_MESSAGE =
  'UpdateGoal `paused` rejected: reason looks like magnitude/calendar/scope escape. Do not pause to renegotiate size — keep the next verifiable slice. Pause only for an honest yield (user asked to stop, waiting on explicit user input). Omit `reason` for a clean pause, or use a concrete yield reason.';

export const CAPACITY_ESCAPE_BLOCKED_MISSING_REASON =
  'UpdateGoal `blocked` requires `reason` — a concrete external blocker (credentials, permission deny, unreachable dependency, contradictory goals). Hard/slow/uncertain work is not blocked; keep slicing.';

const CAPACITY_ESCAPE_PATTERNS = [
  /\bimpossible\b/i,
  /\btoo (?:large|big|complex|much|hard|slow)\b/i,
  /\bnot worth (?:it|doing|the)\b/i,
  /\b(?:would|will) take (?:\d+\s+)?(?:weeks?|months?|sprints?)\b/i,
  /\b(?:reduce|shrink|cut|narrow|trim)\s+(?:the\s+)?scope\b/i,
  /\bDEFERRED\s+to\s+(daylight|tonight|tomorrow)\b/i,
  /\bdeferred\s+to\s+(daylight|tonight|tomorrow)\b/i,
  /\bscale\s+back\b/i,
  /\bnot (?:feasible|practical) (?:without|unless)\b/i,
  /\bmagnitude of (?:the |this )?work\b/i,
  /\bgiven the (?:magnitude|scope|size|scale)\b/i,
] as const;

/** True when the blocked reason is an over-refusal / scope-escape stall. */
export function isCapacityEscapeBlockedReason(reason: string): boolean {
  const text = reason.trim();
  if (text.length === 0) return false;
  return CAPACITY_ESCAPE_PATTERNS.some((pattern) => pattern.test(text));
}
