/**
 * Soft sensor advisory when Goal complete is allowed without the WorkGraph
 * evidence hard gate. Hard blocks stay in markComplete / completion-audit.
 */

import type { UltraworkRun } from '@superliora/protocol';

import { findEvidenceHardGateViolation } from '#/fleet';
import {
  buildTestFailureSoftTips,
  type VerificationFailureRecord,
} from '../../sensors/verification-sensor-ledger';
import {
  buildPendingMutationSoftTips,
  type MutationVerificationLedger,
} from '../../sensors/mutation-verification-sensor';
import { auditUltraworkCompletion, formatEvidenceHardGateNextActions } from '#/mission';
import { parseGoalPredicateCriterion } from './predicate';

export interface GoalCompletionSoftAdvisoryInput {
  readonly ultraworkRun?: UltraworkRun | null | undefined;
  readonly completionCriterion?: string | undefined;
  readonly recentVerificationFailures?: readonly VerificationFailureRecord[] | undefined;
  /** Pending Edit/Write/ApplyPatch mutations without a later green check. */
  readonly mutationVerificationLedger?: MutationVerificationLedger | undefined;
}

export interface GoalCompletionSoftAdvisory {
  readonly tips: readonly string[];
}

const PLAIN_GOAL_SOFT_TIPS: readonly string[] = [
  'Soft sensor: plain Goal completed without WorkGraph evidence gate.',
  'Confirm tests/checks passed (RunProjectChecks) or cite concrete proof before telling the user you are done.',
  'Long missions: use /mission, structured GoalPredicate, or requiredEvidence on WorkGraph nodes for hard gates.',
];

function hasStructuredEvidenceContract(completionCriterion: string | undefined): boolean {
  const parsed = parseGoalPredicateCriterion(completionCriterion);
  if (parsed.kind !== 'structured') return false;
  const spec = parsed.spec;
  return (
    (spec.minEvidenceIds ?? 0) > 0 ||
    (spec.requiredTestFiles?.length ?? 0) > 0 ||
    (spec.requiredPaths?.length ?? 0) > 0 ||
    spec.requireUltraworkGraph === true
  );
}

function isLiveUltraworkRun(run: UltraworkRun | null | undefined): boolean {
  if (run === null || run === undefined) return false;
  return run.status !== 'done' && run.status !== 'failed';
}

function evaluateEvidenceGateSoftAdvisory(
  input: GoalCompletionSoftAdvisoryInput,
): GoalCompletionSoftAdvisory | null {
  const run = input.ultraworkRun ?? null;

  // Live ultrawork runs use the hard gate — rejections are handled elsewhere.
  if (isLiveUltraworkRun(run)) {
    return null;
  }

  if (hasStructuredEvidenceContract(input.completionCriterion)) {
    return null;
  }

  if (run !== null && run.workGraph !== undefined && run.workGraph.nodes.length > 0) {
    const violation = findEvidenceHardGateViolation(run.workGraph.nodes);
    if (violation !== undefined) {
      const graph = run.workGraph.nodes;
      return {
        tips: [
          'Soft sensor: Goal completed without satisfying WorkGraph evidence requirements.',
          `· ${violation.nodeId}: ${violation.reason}`,
          ...formatEvidenceHardGateNextActions(graph).slice(0, 2).map((action) => `· ${action}`),
          'Hard gate applies when a Mission/Ultrawork run is live.',
        ],
      };
    }

    const audit = auditUltraworkCompletion({ run, requireWorkGraph: false });
    if (!audit.ok) {
      return {
        tips: [
          'Soft sensor: Goal completed without passing the WorkGraph evidence gate.',
          ...audit.reasons.slice(0, 2).map((reason) => `· ${reason}`),
          ...audit.nextActions.slice(0, 2).map((action) => `· ${action}`),
          'Hard gate applies when a Mission/Ultrawork run is live.',
        ],
      };
    }
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
  const mutationTips =
    input.mutationVerificationLedger === undefined
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

export function formatGoalCompletionSoftAdvisory(advisory: GoalCompletionSoftAdvisory): string {
  return ['Advisory (soft — not blocking):', ...advisory.tips.map((tip) => `- ${tip}`)].join('\n');
}
