import type { Agent } from '..';
import {
  auditUltraworkCompletion,
  formatCompletionAuditRejection,
  type CompletionAuditRejection,
} from '../../ultrawork/completion-audit';
import { GOAL_COMPLETE_REJECT_COOLDOWN_TURNS } from './goal-constants';
import type { GoalModeHost } from './goal-mode-host';
import { parseGoalPredicateCriterion } from './predicate';
import {
  countEvidenceIds,
  evaluateGoalPredicate,
  formatPredicateFailures,
} from './predicate-runner';
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
    variant: 'ultrawork_completion_rejected',
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
 * When the goal was activated by Ultrawork (or an Ultrawork run is live),
 * require a passing completion audit. Plain standalone goals are unrestricted
 * unless a structured GoalPredicate is set (see evaluateStructured…).
 * Runtime actor still requires audit so empty graphs cannot close via finish.
 */
export function auditUltraworkBoundCompletion(
  agent: Agent,
  _actor: GoalActor,
): CompletionAuditRejection | null {
  const run = agent.ultrawork?.getRun() ?? null;
  // No live ultrawork run: plain goal mode may complete freely (predicate still applies).
  if (run === null) return null;
  // Already terminal: allow markComplete to clear the goal box.
  if (run.status === 'done' || run.status === 'failed') return null;
  const audit = auditUltraworkCompletion({ run, requireWorkGraph: true });
  if (audit.ok) return null;
  return audit;
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

  const run = agent.ultrawork?.getRun() ?? null;
  const workspaceRoot =
    (agent as { config?: { cwd?: string } }).config?.cwd ?? process.cwd();

  try {
    const result = await evaluateGoalPredicate({
      spec: parsed.spec,
      workspaceRoot,
      ultraworkRun: run,
      evidenceIdCount: countEvidenceIds(run),
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
        'Attach evidenceIds / pass Ultrawork audit when requireUltraworkGraph is set.',
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
