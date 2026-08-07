/**
 * Goal completion audit result shape.
 *
 * Prevents false-complete: the model or runtime must not close a goal while
 * sensors, structured predicates, or the user gate command still say no.
 */

export type CompletionAuditCode =
  /**
   * Plain Goal complete blocked: recent check-like failure evidence still sticky
   * (PostToolUse verification sensor — SOTA Phase B hard gate).
   */
  | 'sensor_verification_failed'
  /**
   * Plain Goal complete blocked: Edit/Write/ApplyPatch pending without a later
   * green RunProjectChecks / check-like Bash (mutation sensor hard gate).
   */
  | 'sensor_mutation_unverified'
  /** Structured GoalPredicate evaluation failed (paths/tests/evidence). */
  | 'predicate_failed'
  /** Complete re-attempted before the post-reject cooldown elapsed. */
  | 'reject_cooldown'
  /** User-set goal gate command exited non-zero (or timed out). */
  | 'gate_failed'
  /** Gate command kept failing through its maxRetries budget; goal is parked. */
  | 'gate_retry_exhausted';

export interface CompletionAuditRejection {
  readonly ok: false;
  readonly code: CompletionAuditCode;
  readonly reasons: readonly string[];
  readonly nextActions: readonly string[];
  /** Node ids that still need work (when applicable). */
  readonly openNodeIds?: readonly string[];
}

export interface CompletionAuditPass {
  readonly ok: true;
}

export type CompletionAuditResult = CompletionAuditPass | CompletionAuditRejection;

export function formatCompletionAuditRejection(rejection: CompletionAuditRejection): string {
  const lines = [
    '<goal_completion_rejected>',
    `code: ${rejection.code}`,
    'Completion was rejected to prevent a false complete. The goal stays open.',
    '',
    'Reasons:',
    ...rejection.reasons.map((r) => `- ${r}`),
    '',
    'Next actions:',
    ...rejection.nextActions.map((a) => `- ${a}`),
  ];
  if (rejection.openNodeIds !== undefined && rejection.openNodeIds.length > 0) {
    const head = rejection.openNodeIds.slice(0, 8);
    const overflow = rejection.openNodeIds.length > 8
      ? `, … +${String(rejection.openNodeIds.length - 8)} more`
      : '';
    lines.push('', `Open nodes: ${head.join(', ')}${overflow}`);
  }
  lines.push(
    '',
    'Continue the autonomous loop: implement → verify → attach evidence → only then UpdateGoal(complete).',
    'Do not claim done from audit-only or “already in tree” without proof for this run.',
    '</goal_completion_rejected>',
  );
  return lines.join('\n');
}
