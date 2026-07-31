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
import type {
  UltraSwarmFocusInput,
  UltraSwarmPhase,
  UltraSwarmRenderedResult,
  UltraSwarmRunResult,
  UltraSwarmSpec,
} from './ultra-swarm-phase';
import {
  attachCriticAssignments,
  focusForPhase,
  phaseForAssignment,
} from './ultra-swarm-phase';

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

  // Staffing preview (T4-7a): the whole team with selection rationale,
  // emitted ahead of per-expert bodies so the staffing decision is auditable
  // at a glance (also carried pre-spawn by the ultrawork.team.staffed event).
  lines.push(`<staffing experts="${String(rendered.length)}">`);
  for (const result of rendered) {
    const lane = result.spec.coverageLane === undefined
      ? ''
      : ` coverage_lane="${escapeXml(result.spec.coverageLane)}"`;
    const division = result.spec.division === undefined
      ? ''
      : ` division="${escapeXml(result.spec.division)}"`;
    const reason = result.spec.selectionReason === undefined
      ? ''
      : ` reason="${escapeXml(result.spec.selectionReason)}"`;
    lines.push(
      `<staff expert_id="${escapeXml(result.spec.expertId)}" name="${escapeXml(result.spec.expertName)}" phase="${result.spec.phase}" focus="${result.spec.focus}" required_for_completion="${String(result.spec.requiredForCompletion)}"${lane}${division}${reason}/>`,
    );
  }
  lines.push('</staffing>');

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
      // Staffing audit (T4-7a): every expert carries a non-empty selection
      // reason so auto-selected teams log why each specialist was chosen.
      selectionReason: assignment.selectionReason ?? defaultSelectionReason(assignment, phase),
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

function defaultSelectionReason(assignment: ExpertAssignment, phase: string): string {
  const lane =
    assignment.coverageLane === undefined ? phase : `${phase}/${assignment.coverageLane}`;
  const division = assignment.division ?? assignment.divisionLabel;
  return division === undefined
    ? `Catalog match for ${lane} coverage.`
    : `Catalog match for ${lane} coverage (${division}).`;
}

/**
 * Normalize coverage / work-graph lane ids so plan table shorthand and
 * orchestrator coverage lanes still match (e.g. implementation_core ↔
 * architecture_implementation).
 */
export function normalizeCoverageLaneKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const key = raw.trim().toLowerCase().replaceAll(/[\s-]+/g, '_');
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
  /** War-room / user restaff always wins over cost-control skip. */
  readonly forceRestaff?: boolean;
}): boolean {
  if (input.forceRestaff === true) return false;
  return (
    input.pausedForSteer === true ||
    input.decision === 'strong-approve' ||
    (input.decision === 'approve' && input.intensity === 'light')
  );
}

/**
 * Whether the phased UltraSwarm loop should stop after a phase checkpoint.
 * - Steer texts always pause (Pause-Redirect-Resume).
 * - War-room pauseUltrawork sets `pausedForSteer` without steer text.
 */
export function shouldStopPhaseLoopAtCheckpoint(input: {
  readonly steerTexts: readonly string[];
  readonly pausedForSteer: boolean | undefined;
}): boolean {
  if (input.steerTexts.length > 0) return true;
  return input.pausedForSteer === true;
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
