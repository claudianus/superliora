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

export function renderUltraSwarmResults(
  rendered: readonly UltraSwarmRenderedResult[],
  plan: { readonly taskDescription: string; readonly strategy: string },
  runId: string,
): string {
  const completed = rendered.filter((r) => r.status === 'completed').length;
  const failed = rendered.filter((r) => r.status === 'failed').length;
  const aborted = rendered.filter((r) => r.status === 'aborted').length;

  const lines = [
    `<ultra_swarm_result run_id="${escapeXml(runId)}">`,
    `<task>${escapeXml(plan.taskDescription)}</task>`,
    `<strategy>${plan.strategy}</strategy>`,
    `<summary>completed: ${String(completed)}, failed: ${String(failed)}, aborted: ${String(aborted)}</summary>`,
    '<coverage>Each expert row includes the assigned coverage lane and selection reason for auditability.</coverage>',
  ];

  for (const result of rendered) {
    const agentId = result.agentId === undefined ? '' : ` agent_id="${result.agentId}"`;
    const state = result.state === undefined ? '' : ` state="${result.state}"`;
    const lane = result.spec.coverageLane === undefined
      ? ''
      : ` coverage_lane="${escapeXml(result.spec.coverageLane)}"`;
    const division = result.spec.division === undefined
      ? ''
      : ` division="${escapeXml(result.spec.division)}"`;
    const dependsOn = result.spec.dependsOn === undefined || result.spec.dependsOn.length === 0
      ? ''
      : ` depends_on="${escapeXml(result.spec.dependsOn.join(','))}"`;
    const evidenceIds = result.evidenceIds.length === 0
      ? ''
      : ` evidence_ids="${escapeXml(result.evidenceIds.join(','))}"`;
    const workNodeIds = result.spec.workNodeIds.length === 0
      ? ''
      : ` work_node_ids="${escapeXml(result.spec.workNodeIds.join(','))}"`;
    const body =
      result.status === 'completed'
        ? (result.result ?? '')
        : (result.error ?? 'unknown error');
    const selectionReason = result.spec.selectionReason === undefined
      ? ''
      : `<selection_reason>${escapeXml(result.spec.selectionReason)}</selection_reason>\n`;
    lines.push(
      `<expert expert_id="${escapeXml(result.spec.expertId)}" name="${escapeXml(result.spec.expertName)}" emoji="${escapeXml(result.spec.emoji)}" color="${escapeXml(result.spec.color)}" phase="${result.spec.phase}" focus="${result.spec.focus}" outcome="${result.status}" verdict="${result.verdict}" required_for_completion="${String(result.spec.requiredForCompletion)}"${agentId}${state}${division}${lane}${dependsOn}${workNodeIds}${evidenceIds}>\n${selectionReason}${body}\n</expert>`,
    );
  }

  lines.push(buildUltraSwarmIntegrationReportXml(rendered, runId));
  lines.push(
    '<integration_handoff>Read integration_report for per-agent work summaries. Parent agent must integrate accepted specialist handoffs into product-file changes and verification evidence.</integration_handoff>',
  );
  lines.push('</ultra_swarm_result>');
  return lines.join('\n');
}

export function withRenderedMetadata(result: UltraSwarmRunResult): UltraSwarmRenderedResult {
  const text = result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');
  // UltraSwarmRunResult uses started/not_started; map onto outcome-state for verdict inference.
  const outcomeState =
    result.state === 'started'
      ? 'running'
      : result.state === 'not_started'
        ? 'not_started'
        : undefined;
  return {
    ...result,
    verdict: inferVerdict(result.status, text, outcomeState, result.spec.phase),
    evidenceIds: extractEvidenceIds(text),
  };
}

export function buildRestaffSpecs(input: {
  readonly experts: readonly ExpertAssignment[];
  readonly startIndex: number;
  readonly phase: UltraSwarmPhase;
  readonly focus: UltraSwarmFocusInput['focus'];
  readonly runId: string;
  readonly workNodeIds: readonly string[];
}): UltraSwarmSpec[] {
  return input.experts.map((assignment, offset) => ({
    index: input.startIndex + offset + 1,
    expertId: assignment.expertId,
    expertName: assignment.expertName,
    division: assignment.division ?? assignment.divisionLabel,
    assignmentPrompt: assignment.prompt,
    phase: input.phase,
    focus: focusForPhase(input.phase, input.focus),
    dependsOn: assignment.dependsOn,
    emoji: assignment.emoji,
    color: assignment.color,
    coverageLane: assignment.coverageLane,
    selectionReason: assignment.selectionReason ?? 'Restaffed after revision gaps.',
    runId: input.runId,
    requiredForCompletion: true,
    workNodeIds: input.workNodeIds,
  }));
}

export function buildInitialSpecs(input: {
  readonly experts: readonly ExpertAssignment[];
  readonly focus: UltraSwarmFocusInput['focus'];
  readonly runId: string;
  readonly workNodeIds: readonly string[];
  readonly requiredExpertIds: ReadonlySet<string>;
  /** Optional work-graph nodes for lane-aware ownership (preferred over id-only list). */
  readonly workNodes?: readonly WorkGraphNode[];
}): UltraSwarmSpec[] {
  const expertCount = input.experts.length;
  const ownership = assignWorkNodeIdsToExperts({
    experts: input.experts,
    workNodeIds: input.workNodeIds,
    workNodes: input.workNodes,
  });

  return input.experts.map((assignment, index) => {
    const phase = phaseForAssignment(assignment, input.focus);
    return {
      index: index + 1,
      expertId: assignment.expertId,
      expertName: assignment.expertName,
      division: assignment.division ?? assignment.divisionLabel,
      assignmentPrompt: assignment.prompt,
      phase,
      focus: focusForPhase(phase, input.focus),
      dependsOn: assignment.dependsOn,
      emoji: assignment.emoji,
      color: assignment.color,
      coverageLane: assignment.coverageLane,
      selectionReason: assignment.selectionReason,
      runId: input.runId,
      // focus=full no longer marks every expert completion-critical; only required
      // ids, review-phase experts, and review-only focus do.
      requiredForCompletion:
        input.requiredExpertIds.has(assignment.expertId) ||
        phase === 'review' ||
        input.focus === 'review',
      workNodeIds: expertCount === 0 ? [] : (ownership[index] ?? []),
    };
  });
}

/**
 * Normalize coverage / work-graph lane ids so plan table shorthand and
 * orchestrator coverage lanes still match (e.g. implementation_core ↔
 * architecture_implementation).
 */
export function normalizeCoverageLaneKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (key.length === 0) return undefined;
  const aliases: Record<string, string> = {
    implementation_core: 'architecture_implementation',
    implementation: 'architecture_implementation',
    architecture: 'architecture_implementation',
    engineering: 'architecture_implementation',
    product: 'product_requirements',
    requirements: 'product_requirements',
    testing: 'testing_evidence',
    test: 'testing_evidence',
    qa: 'testing_evidence',
    review: 'testing_evidence',
    security: 'security_privacy',
    privacy: 'security_privacy',
    performance: 'performance_reliability',
    reliability: 'performance_reliability',
    ux: 'ux_visual_content',
    ui: 'ux_visual_content',
    visual: 'ux_visual_content',
    design: 'ux_visual_content',
    domain: 'domain_subject_matter',
    research: 'domain_subject_matter',
  };
  return aliases[key] ?? key;
}

/** Map Ultrawork stage → preferred coverage lane when laneId is missing/mismatched. */
export function coverageLaneForWorkStage(stage: WorkGraphNode['stage'] | undefined): string | undefined {
  if (stage === undefined) return undefined;
  switch (stage) {
    case 'research':
    case 'intake':
      return 'domain_subject_matter';
    case 'plan':
    case 'goal':
      return 'product_requirements';
    case 'staff':
    case 'swarm':
    case 'integrate':
      return 'architecture_implementation';
    case 'verify':
      return 'testing_evidence';
    case 'learn':
    case 'done':
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Partition work nodes across experts. Prefer matching normalized `laneId`
 * (or stage-derived lane) to the expert's coverage lane; remaining nodes go
 * round-robin by expert index.
 */
export function assignWorkNodeIdsToExperts(input: {
  readonly experts: readonly ExpertAssignment[];
  readonly workNodeIds: readonly string[];
  readonly workNodes?: readonly WorkGraphNode[];
}): readonly (readonly string[])[] {
  const expertCount = input.experts.length;
  if (expertCount === 0) return [];
  const buckets: string[][] = Array.from({ length: expertCount }, () => []);
  if (input.workNodeIds.length === 0) return buckets;

  const nodeById = new Map((input.workNodes ?? []).map((node) => [node.id, node]));
  const laneToExpertIndex = new Map<string, number>();
  for (let i = 0; i < expertCount; i += 1) {
    const lane = normalizeCoverageLaneKey(input.experts[i]?.coverageLane);
    if (lane !== undefined && !laneToExpertIndex.has(lane)) {
      laneToExpertIndex.set(lane, i);
    }
  }

  const unassigned: string[] = [];
  for (const nodeId of input.workNodeIds) {
    const node = nodeById.get(nodeId);
    const fromLaneId = normalizeCoverageLaneKey(node?.laneId);
    const fromStage = coverageLaneForWorkStage(node?.stage);
    const laneMatch =
      (fromLaneId !== undefined ? laneToExpertIndex.get(fromLaneId) : undefined) ??
      (fromStage !== undefined ? laneToExpertIndex.get(fromStage) : undefined);
    if (laneMatch !== undefined) {
      buckets[laneMatch]!.push(nodeId);
    } else {
      unassigned.push(nodeId);
    }
  }

  for (let i = 0; i < unassigned.length; i += 1) {
    buckets[i % expertCount]!.push(unassigned[i]!);
  }
  return buckets;
}

export function shouldSkipAdaptiveRestaff(input: {
  readonly pausedForSteer: boolean | undefined;
  readonly decision: CouncilDecision;
  readonly intensity: SwarmRoutingIntensity | undefined;
}): boolean {
  return (
    input.pausedForSteer === true ||
    input.decision === 'strong-approve' ||
    (input.decision === 'approve' && input.intensity === 'light')
  );
}

export type UltraSwarmWavePlanEntry = {
  readonly spec: UltraSwarmSpec;
  readonly swarmItem: string;
  readonly descriptionSuffix: string;
};

/** Dependency-aware wave grouping for a phase; pure over already-built specs. */
export function planPhaseWaveEntries(
  phaseSpecs: readonly UltraSwarmSpec[],
  waves: readonly (readonly UltraSwarmSpec[])[],
): readonly (readonly UltraSwarmWavePlanEntry[])[] {
  return waves.map((wave) =>
    wave.map((spec) => ({
      spec,
      swarmItem: spec.workNodeIds.length === 1 ? (spec.workNodeIds[0] ?? spec.expertId) : spec.expertId,
      descriptionSuffix: `#${String(spec.index)} (${spec.expertName} ${spec.emoji})`,
    })),
  );
}

export function shouldPostImplementWaveStandup(
  busEnabled: boolean,
  phase: UltraSwarmPhase,
): boolean {
  return busEnabled && phase === 'implement';
}

export function canAttemptRestaff(input: {
  readonly renderedCount: number;
  readonly specsCount: number;
  readonly maxExperts: number;
  readonly gapCount: number;
}): boolean {
  if (input.gapCount === 0) return false;
  const slots = Math.max(0, input.maxExperts - input.specsCount);
  return slots > 0 && input.specsCount < input.maxExperts;
}

export function restaffReflectionBusDigest(busEnabled: boolean, digest: string | undefined): string | undefined {
  if (!busEnabled) return undefined;
  return digest;
}

/** Attach critic edges for restaffed review experts when intensity supports it. */
export function selectRestaffPhaseSpecs(input: {
  readonly phase: UltraSwarmPhase;
  readonly restaffSpecs: readonly UltraSwarmSpec[];
  readonly priorRendered: readonly UltraSwarmRenderedResult[];
  readonly intensity: SwarmRoutingIntensity | undefined;
}): UltraSwarmSpec[] {
  if (input.phase !== 'review') return [...input.restaffSpecs];
  return attachCriticAssignments(input.restaffSpecs, input.priorRendered, input.intensity);
}
