/**
 * Pure UltraSwarm phase/plan/render helpers and shared swarm result types.
 */

import type { TeamPlan, WorkGraphNode } from '@superliora/protocol';
import type { ExpertAssignment } from '../../../expert-agents/types';

import {
  assignReviewCriticEdges,
  assignDiverseCriticEdges,
  CRITIC_LENSES,
  type CriticAssignment,
  type CriticLens,
} from '../../../session/ultra-swarm-critic';
import {
  consensusFromDiverseVotes,
  extractLensVotes,
  type CouncilDecision,
} from '../../../session/ultra-swarm-consensus';
import type { SwarmRoutingIntensity } from '../../../agent/plan/ultra-swarm-routing';
import { collapseForHandoff } from '../../../agent/compaction/handoff-collapse';
import { buildUltraSwarmIntegrationReportXml } from './ultra-swarm-integration-report';
import {
  escapeXml,
  extractEvidenceIds,
  inferVerdict,
  uniqueStrings,
} from './ultra-swarm-helpers';

export const ULTRA_SWARM_PHASES = ['plan', 'implement', 'review'] as const;
export type UltraSwarmPhase = typeof ULTRA_SWARM_PHASES[number];
export type UltraSwarmFocus = 'plan' | 'research' | 'implement' | 'review' | 'full';

export type UltraSwarmFocusInput = {
  readonly focus?: UltraSwarmFocus;
  readonly intensity?: 'balanced' | 'premium' | 'max';
  readonly required_experts?: readonly string[];
};


export interface UltraSwarmSpec {
  readonly index: number;
  readonly expertId: string;
  readonly expertName: string;
  readonly division?: string;
  readonly assignmentPrompt: string;
  readonly phase: UltraSwarmPhase;
  readonly focus: UltraSwarmFocus;
  readonly dependsOn?: readonly string[];
  readonly emoji: string;
  readonly color: string;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
  readonly runId: string;
  readonly requiredForCompletion: boolean;
  readonly workNodeIds: readonly string[];
  readonly criticAssignment?: CriticAssignment;
}

export interface UltraSwarmRunResult {
  readonly spec: UltraSwarmSpec;
  readonly agentId?: string;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly state?: 'started' | 'not_started';
  readonly result?: string;
  readonly error?: string;
}

export interface UltraSwarmRenderedResult extends UltraSwarmRunResult {
  readonly verdict: 'PASS' | 'PASS_WITH_ADVICE' | 'BLOCKED' | 'FAIL' | 'ABORTED' | 'SKIPPED';
  readonly evidenceIds: readonly string[];
}

export function phaseForAssignment(
  assignment: ExpertAssignment,
  focus: UltraSwarmFocusInput['focus'],
): UltraSwarmPhase {
  if (focus === 'plan' || focus === 'research') return 'plan';
  if (focus === 'review') return 'review';
  const lane = assignment.coverageLane;
  if (lane === 'product_requirements' || lane === 'domain_subject_matter') return 'plan';
  if (
    lane === 'testing_evidence' ||
    lane === 'security_privacy' ||
    lane === 'performance_reliability'
  ) {
    return 'review';
  }
  return 'implement';
}

export function focusForPhase(
  phase: UltraSwarmPhase,
  requestedFocus: UltraSwarmFocusInput['focus'],
): UltraSwarmFocus {
  if (requestedFocus === 'full') return 'full';
  if (requestedFocus === 'research') return phase === 'plan' ? 'research' : phase;
  if (requestedFocus === 'review') return 'review';
  if (requestedFocus === 'plan') return 'plan';
  return phase;
}

export function ownerExpertIdForWorkNodes(specs: readonly UltraSwarmSpec[]): string | undefined {
  return (
    specs.find((spec) => spec.phase === 'implement') ??
    specs.find((spec) => spec.phase === 'plan') ??
    specs[0]
  )?.expertId;
}

export function blockingRequiredResult(
  results: readonly UltraSwarmRenderedResult[],
  phase: UltraSwarmPhase,
): UltraSwarmRenderedResult | undefined {
  if (phase !== 'plan' && phase !== 'review') return undefined;
  return results.find((result) =>
    result.spec.requiredForCompletion &&
    result.status === 'completed' &&
    result.verdict !== 'PASS'
  );
}

export function blockedResultsForPhase(
  specs: readonly UltraSwarmSpec[],
  blockedBy: UltraSwarmRenderedResult,
): UltraSwarmRunResult[] {
  const message =
    `Skipped because required ${blockedBy.spec.phase} expert ${blockedBy.spec.expertId} returned ${blockedBy.verdict}.`;
  return specs.map((spec) => ({
    spec,
    status: 'aborted' as const,
    state: 'not_started' as const,
    error: message,
  }));
}

export function buildTeamPlan(
  runId: string,
  specs: readonly UltraSwarmSpec[],
  args: UltraSwarmFocusInput,
  maxExperts: number,
): TeamPlan {
  return {
    id: `team-${runId}`,
    runId,
    intensity: args.intensity ?? 'balanced',
    maxExperts,
    requiredExperts: args.required_experts,
    councilExpertIds: specs
      .filter((spec) => spec.phase === 'review')
      .map((spec) => spec.expertId),
    reason: 'UltraSwarm staffed a phased specialist team.',
    experts: specs.map((spec) => ({
      id: spec.expertId,
      name: spec.expertName,
      role: spec.coverageLane ?? spec.division ?? 'specialist',
      focus: spec.focus,
      status: 'queued',
      taskIds: spec.workNodeIds.length > 0 ? spec.workNodeIds : undefined,
      division: spec.division,
      emoji: spec.emoji,
      color: spec.color,
      coverageLane: spec.coverageLane,
      selectionReason: spec.selectionReason,
      dependsOn: spec.dependsOn,
    })),
  };
}

export function augmentTeamPlan(
  team: TeamPlan,
  newSpecs: readonly UltraSwarmSpec[],
  args: UltraSwarmFocusInput,
  maxExperts: number,
): TeamPlan {
  return {
    ...team,
    maxExperts,
    reason: 'UltraSwarm restaffed additional specialists after revision gaps.',
    experts: [
      ...team.experts,
      ...newSpecs.map((spec) => ({
        id: spec.expertId,
        name: spec.expertName,
        role: spec.coverageLane ?? spec.division ?? 'specialist',
        focus: spec.focus,
        status: 'queued' as const,
        taskIds: spec.workNodeIds.length > 0 ? spec.workNodeIds : undefined,
        division: spec.division,
        emoji: spec.emoji,
        color: spec.color,
        coverageLane: spec.coverageLane,
        selectionReason: spec.selectionReason,
        dependsOn: spec.dependsOn,
      })),
    ],
  };
}

export function councilDecisionFromReview(
  results: readonly UltraSwarmRenderedResult[],
): CouncilDecision {
  const reviewResults = results.filter((result) => result.spec.phase === 'review');
  if (
    reviewResults.length > 0 &&
    reviewResults.every((result) => result.verdict === 'ABORTED' || result.verdict === 'SKIPPED')
  ) {
    return 'interrupted';
  }
  const votes = extractLensVotes(reviewResults);
  if (votes.length === 0) {
    // No completed reviews — fall back to the prior rule-based path.
    if (reviewResults.some((result) => result.verdict === 'FAIL')) return 'block';
    if (reviewResults.some((result) => result.verdict !== 'PASS')) return 'revise';
    return 'approve';
  }
  return consensusFromDiverseVotes(votes);
}

export function lensesForIntensity(intensity: SwarmRoutingIntensity | undefined): readonly CriticLens[] {
  const specStrict = CRITIC_LENSES[0];
  const adversarial = CRITIC_LENSES[1];
  if (intensity === 'light') {
    return specStrict !== undefined ? [specStrict] : CRITIC_LENSES.slice(0, 1);
  }
  if (intensity === 'standard') {
    return specStrict !== undefined && adversarial !== undefined
      ? [specStrict, adversarial]
      : CRITIC_LENSES.slice(0, 2);
  }
  // heavy or undefined → all three lenses
  return CRITIC_LENSES;
}

export function attachCriticAssignments(
  specs: readonly UltraSwarmSpec[],
  priorResults: readonly UltraSwarmRenderedResult[],
  intensity: SwarmRoutingIntensity | undefined,
): UltraSwarmSpec[] {
  const lenses = lensesForIntensity(intensity);
  const sources = priorResults
    .filter((result) => result.status === 'completed')
    .map((result) => ({
      expertId: result.spec.expertId,
      expertName: result.spec.expertName,
      phase: result.spec.phase,
      verdict: result.verdict,
      handoff: collapseForHandoff(result.result ?? result.error ?? ''),
    }));
  const assignments =
    lenses.length >= 2
      ? assignDiverseCriticEdges(
          specs.map((spec) => ({ expertId: spec.expertId, expertName: spec.expertName })),
          sources,
          lenses,
        )
      : assignReviewCriticEdges(
          specs.map((spec) => ({ expertId: spec.expertId, expertName: spec.expertName })),
          sources,
        );
  return specs.map((spec) => {
    const assignment = assignments.get(spec.expertId);
    if (assignment === undefined) return spec;
    return { ...spec, criticAssignment: assignment };
  });
}

export function buildPhaseHandoff(
  results: readonly UltraSwarmRenderedResult[],
  busDigest: string,
): string {
  const lines = ['<phase_handoff_pack>'];
  for (const result of results.slice(-12)) {
    const text = collapseForHandoff(result.result ?? result.error ?? '');
    const evidence = result.evidenceIds.length === 0
      ? ''
      : ` evidence_ids="${escapeXml(result.evidenceIds.join(','))}"`;
    lines.push(
      `<handoff expert_id="${escapeXml(result.spec.expertId)}" phase="${result.spec.phase}" verdict="${result.verdict}"${evidence}>${escapeXml(text)}</handoff>`,
    );
  }
  lines.push('</phase_handoff_pack>');
  if (busDigest.length > 0) {
    lines.push('');
    lines.push(busDigest);
  }
  return lines.join('\n');
}

export function workNodeOutcome(results: readonly UltraSwarmRenderedResult[]): {
  readonly status: WorkGraphNode['status'];
  readonly verificationStatus: NonNullable<WorkGraphNode['verificationStatus']>;
  readonly evidenceIds: readonly string[];
  readonly summary: string;
} {
  const evidenceIds = uniqueStrings(results.flatMap((result) => result.evidenceIds));
  const failed = results.some((result) => result.status === 'failed' || result.verdict === 'FAIL');
  const blocked = results.some((result) => result.verdict === 'BLOCKED');
  // Successful swarm work needs main-agent integrate/verify before `done`.
  const status: WorkGraphNode['status'] = failed
    ? 'failed'
    : blocked
      ? 'blocked'
      : 'needs_integration';
  const verificationStatus: NonNullable<WorkGraphNode['verificationStatus']> =
    status === 'failed' ? 'failed' : status === 'blocked' ? 'blocked' : 'pending';
  const summary = `UltraSwarm completed ${String(results.length)} expert result(s): ${results
    .map((result) => `${result.spec.expertId}=${result.verdict}`)
    .join(', ')}`;
  return { status, verificationStatus, evidenceIds, summary };
}

export function ownerResultForWorkNodes(
  results: readonly UltraSwarmRenderedResult[],
): UltraSwarmRenderedResult | undefined {
  return (
    results.find((result) => result.spec.phase === 'implement' && result.status === 'completed') ??
    results.find((result) => result.spec.phase === 'plan' && result.status === 'completed') ??
    results.find((result) => result.status === 'completed') ??
    results[0]
  );
}

export {
  renderUltraSwarmResults,
  withRenderedMetadata,
  buildRestaffSpecs,
  buildInitialSpecs,
  normalizeCoverageLaneKey,
  coverageLaneForWorkStage,
  assignWorkNodeIdsToExperts,
  shouldSkipAdaptiveRestaff,
  shouldStopPhaseLoopAtCheckpoint,
  planPhaseWaveEntries,
  shouldPostImplementWaveStandup,
  canAttemptRestaff,
  restaffReflectionBusDigest,
  selectRestaffPhaseSpecs,
  type UltraSwarmWavePlanEntry,
} from './ultra-swarm-render';
