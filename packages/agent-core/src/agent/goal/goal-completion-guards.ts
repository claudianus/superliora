import type { Agent } from '..';
import {
  formatCompletionAuditRejection,
  type CompletionAuditRejection,
} from './completion-audit';
import {
  buildPendingMutationSoftTips,
  type MutationVerificationLedger,
} from '../../sensors/mutation-verification-sensor';
import {
  buildTestFailureSoftTips,
  filterRecentVerificationFailures,
  type VerificationSensorLedger,
} from '../../sensors/verification-sensor-ledger';
import { GOAL_COMPLETE_REJECT_COOLDOWN_TURNS } from './goal-constants';
import type { GoalModeHost } from './goal-mode-host';
import { parseGoalPredicateCriterion } from './predicate';
import { evaluateGoalPredicate, formatPredicateFailures } from './predicate-runner';
import type { GoalActor, GoalState } from './types';

export function checkCompleteRejectCooldown(
  host: GoalModeHost,
  state: GoalState,
  actor: GoalActor,
): CompletionAuditRejection | null {
  // Runtime finish paths may close a verified run without waiting for cooldown.
  if (actor === 'runtime' || actor === 'system') return null;
  if (host.lastRejectAtTurn === undefined || host.completionRejectStreak === 0) {
    return null;
  }
  const elapsed = state.turnsUsed - host.lastRejectAtTurn;
  if (elapsed >= GOAL_COMPLETE_REJECT_COOLDOWN_TURNS) return null;
  const remaining = GOAL_COMPLETE_REJECT_COOLDOWN_TURNS - elapsed;
  // Re-surface the prior audit rejection so cooldown turns still show
  // concrete repair actions (node_failed / dependsOn / stuck / verification-gap /
  // evidence hard-gate) instead of only "wait N turns" generic lines.
  const prior = host.lastCompletionRejection;
  const priorCode =
    prior !== undefined && prior.code !== 'reject_cooldown' ? prior.code : undefined;
  // Keep up to 3 prior actions so multi-hint audits (evidence + verification + stuck)
  // survive cooldown without collapsing to a single generic line.
  const priorActions =
    prior !== undefined && prior.code !== 'reject_cooldown'
      ? prior.nextActions.slice(0, 3)
      : [];
  return {
    ok: false,
    code: 'reject_cooldown',
    reasons: [
      `Completion rejected: cooldown active (${elapsed}/${GOAL_COMPLETE_REJECT_COOLDOWN_TURNS} turns since last false complete).`,
      `Reject streak: ${host.completionRejectStreak}. Wait ~${remaining} more goal turn(s) and make real progress before UpdateGoal(complete).`,
      ...(priorCode !== undefined ? [`Prior rejection code: ${priorCode}.`] : []),
      ...(prior !== undefined && prior.code !== 'reject_cooldown'
        ? prior.reasons.slice(0, 3)
        : []),
    ],
    nextActions: [
      ...priorActions,
      'Implement or verify open work (tests, evidence, WorkGraph nodes).',
      `Do not spam UpdateGoal(complete); wait at least ${GOAL_COMPLETE_REJECT_COOLDOWN_TURNS} goal turns after a rejection.`,
    ],
    openNodeIds: prior?.openNodeIds,
  };
}

export function recordCompletionRejection(
  host: GoalModeHost,
  state: GoalState,
  rejection: CompletionAuditRejection,
  actor: GoalActor,
): void {
  host.lastCompletionRejection = rejection;
  // Cooldown rejections do not inflate the streak further.
  if (rejection.code !== 'reject_cooldown') {
    host.completionRejectStreak += 1;
    host.lastRejectAtTurn = state.turnsUsed;
  }
  host.agent.context.appendSystemReminder(formatCompletionAuditRejection(rejection), {
    kind: 'injection',
    variant: 'goal_completion_rejected',
  });
  host.agent.log?.warn?.('goal markComplete rejected', {
    code: rejection.code,
    actor,
    reasons: rejection.reasons,
    streak: host.completionRejectStreak,
  });
  host.agent.telemetry.track('goal_complete_audit_rejected', {
    code: rejection.code,
    actor,
    open_nodes: rejection.openNodeIds?.length ?? 0,
    reject_streak: host.completionRejectStreak,
  });
}

/**
 * Hard gate for plain (and all) Goal complete paths: sticky PostToolUse sensor
 * evidence blocks false-done. Soft tips alone were ~70% compliance; this is
 * mechanical enforcement (SOTA Sensors > Guides).
 *
 * Runtime/system actors may still close after external verification (finish-run).
 */
export function auditSensorBoundCompletion(
  agent: Agent,
  actor: GoalActor,
  nowMs: number = Date.now(),
): CompletionAuditRejection | null {
  if (actor === 'runtime' || actor === 'system') return null;

  const failureRejection = auditRecentVerificationFailures(
    agent.verificationSensorLedger,
    nowMs,
  );
  if (failureRejection !== null) return failureRejection;

  return auditPendingMutations(agent.mutationVerificationLedger, nowMs);
}

export function auditRecentVerificationFailures(
  ledger: VerificationSensorLedger | undefined,
  nowMs: number = Date.now(),
): CompletionAuditRejection | null {
  if (ledger === undefined) return null;
  const recent = filterRecentVerificationFailures(ledger.failures, nowMs);
  if (recent.length === 0) return null;
  const latest = recent.at(-1)!;
  const soft = buildTestFailureSoftTips(ledger.failures, nowMs);
  return {
    ok: false,
    code: 'sensor_verification_failed',
    reasons: [
      'Completion rejected: recent test/command failure evidence is still sticky.',
      `Latest: ${latest.toolName} — ${latest.summary}`,
      ...soft.slice(0, 2),
    ],
    nextActions: [
      'Re-run RunProjectChecks or the failing check-like command until green.',
      'Green check-like Bash (test/typecheck/lint/tsc) clears this gate.',
      'Only then call UpdateGoal(complete).',
    ],
  };
}

export function auditPendingMutations(
  ledger: MutationVerificationLedger | undefined,
  nowMs: number = Date.now(),
): CompletionAuditRejection | null {
  if (ledger === undefined) return null;
  const tips = buildPendingMutationSoftTips(ledger, nowMs);
  if (tips.length === 0) return null;
  return {
    ok: false,
    code: 'sensor_mutation_unverified',
    reasons: [
      'Completion rejected: source files were mutated without a subsequent green verification check.',
      ...tips.slice(0, 3),
    ],
    nextActions: [
      'Run RunProjectChecks (or package-scoped test/typecheck/lint) and confirm green.',
      'Green check-like Bash also clears pending mutations.',
      'Only then call UpdateGoal(complete).',
    ],
  };
}

/**
 * Evaluate structured GoalPredicate embedded in completionCriterion.
 * Legacy free-text criteria are not machine-checked here (model + UW audit).
 */
export async function evaluateStructuredCompletionPredicate(
  agent: Agent,
  state: GoalState,
): Promise<CompletionAuditRejection | null> {
  const parsed = parseGoalPredicateCriterion(state.completionCriterion);
  if (parsed.kind !== 'structured') return null;

  const workspaceRoot =
    (agent as { config?: { cwd?: string } }).config?.cwd ?? process.cwd();

  try {
    const result = await evaluateGoalPredicate({
      spec: parsed.spec,
      workspaceRoot,
    });
    if (result.ok) return null;
    return {
      ok: false,
      code: 'predicate_failed',
      reasons: [
        'Structured GoalPredicate evaluation failed.',
        ...result.failures.map((f) => `[${f.code}] ${f.message}`),
      ],
      nextActions: [
        'Create missing requiredPaths or fix requiredTestFiles.',
        'Only then call UpdateGoal(complete).',
      ],
    };
  } catch (error) {
    return {
      ok: false,
      code: 'predicate_failed',
      reasons: [
        `GoalPredicate runner error: ${error instanceof Error ? error.message : String(error)}`,
        formatPredicateFailures([]),
      ],
      nextActions: [
        'Fix the predicate runner environment (workspace cwd, vitest) and retry.',
      ],
    };
  }
}
