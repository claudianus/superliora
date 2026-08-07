/**
 * Soft sensor advisory when Goal complete is allowed without the WorkGraph
 * evidence hard gate. Hard blocks stay in markComplete / completion-audit.
 */

import {
  buildTestFailureSoftTips,
  type VerificationFailureRecord,
} from '../../sensors/verification-sensor-ledger';
import {
  buildPendingMutationSoftTips,
  type MutationVerificationLedger,
} from '../../sensors/mutation-verification-sensor';
import { parseGoalPredicateCriterion } from './predicate';

export interface GoalCompletionSoftAdvisoryInput {
  readonly completionCriterion?: string | undefined;
  readonly recentVerificationFailures?: readonly VerificationFailureRecord[] | undefined;
  /** Pending Edit/Write/ApplyPatch mutations without a later green check. */
  readonly mutationVerificationLedger?: MutationVerificationLedger | undefined;
  /**
   * Loop21c: green AUTO_CHECK_SPAWN within cooldown — suppress mutation-only
   * soft tips (verification failures still surface).
   */
  readonly recentAutoCheckSpawnOk?: boolean | undefined;
}

export interface GoalCompletionSoftAdvisory {
  readonly tips: readonly string[];
}

const PLAIN_GOAL_SOFT_TIPS: readonly string[] = [
  'Soft sensor: plain Goal completed without WorkGraph evidence gate.',
  'Confirm tests/checks passed (RunProjectChecks) or cite concrete proof before telling the user you are done.',
  'Long tasks: use a structured GoalPredicate, or requiredEvidence on WorkGraph nodes, for hard gates.',
];

function hasStructuredEvidenceContract(completionCriterion: string | undefined): boolean {
  const parsed = parseGoalPredicateCriterion(completionCriterion);
  if (parsed.kind !== 'structured') return false;
  const spec = parsed.spec;
  return (
    (spec.minEvidenceIds ?? 0) > 0 ||
    (spec.requiredTestFiles?.length ?? 0) > 0 ||
    (spec.requiredPaths?.length ?? 0) > 0
  );
}

function evaluateEvidenceGateSoftAdvisory(
  input: GoalCompletionSoftAdvisoryInput,
): GoalCompletionSoftAdvisory | null {
  if (hasStructuredEvidenceContract(input.completionCriterion)) {
    return null;
  }
  return { tips: PLAIN_GOAL_SOFT_TIPS };
}

/**
 * Returns advisory tips when completion succeeded on a path that skipped the
 * live WorkGraph evidence hard gate, or when recent test/command failures
 * were recorded. Returns null when hard gate already enforced evidence and
 * no failure evidence exists. Never hard-blocks — append-only soft tips.
 */
export function evaluateGoalCompletionSoftAdvisory(
  input: GoalCompletionSoftAdvisoryInput,
): GoalCompletionSoftAdvisory | null {
  const base = evaluateEvidenceGateSoftAdvisory(input);
  const failureTips = buildTestFailureSoftTips(input.recentVerificationFailures ?? []);
  // Loop21c: green spawn already re-verified mutations — skip mutation tips only.
  const mutationTips =
    input.recentAutoCheckSpawnOk === true || input.mutationVerificationLedger === undefined
      ? []
      : buildPendingMutationSoftTips(input.mutationVerificationLedger);
  const extras = [...failureTips, ...mutationTips];
  if (extras.length === 0) {
    return base;
  }
  if (base === null) {
    return { tips: extras };
  }
  return { tips: [...base.tips, ...extras] };
}

/**
 * Loop36a — stable marker so TUI can surface completion soft advisories
 * (plain Goal complete without evidence gate / sticky failures).
 */
export const GOAL_SOFT_ADVISORY_PREFIX = 'GOAL_SOFT_ADVISORY:' as const;

export function formatGoalCompletionSoftAdvisory(advisory: GoalCompletionSoftAdvisory): string {
  return [
    `${GOAL_SOFT_ADVISORY_PREFIX} Advisory (soft — not blocking):`,
    ...advisory.tips.map((tip) => `- ${tip}`),
  ].join('\n');
}

/** Loop36a — false-complete hard reject marker (isError UpdateGoal path). */
export const GOAL_FALSE_COMPLETE_CODE = 'GOAL_FALSE_COMPLETE' as const;

export function formatGoalFalseCompleteRejectTip(code: string): string {
  return (
    `${GOAL_FALSE_COMPLETE_CODE}: Goal completion rejected (false-complete guard). ` +
    `code=${code}. Keep implementing and verifying; do not claim done without WorkGraph evidence.`
  );
}
