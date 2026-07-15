/**
 * Pure UltraSwarm helpers shared by the UltraSwarm tool.
 */

import type { WorkGraphNode } from '@superliora/protocol';
import { collapseForHandoff } from '../../../agent/compaction/handoff-collapse';
import type { ExpertAssignment, ExpertSwarmPlan } from '../../../expert-agents/types';

export const MAX_ULTRA_SWARM_SUBAGENTS = 128;

export function cloneStringList(values: readonly string[] | undefined): readonly string[] | undefined {
  return values === undefined ? undefined : [...values];
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export type UltraSwarmOutcomeStatus = 'completed' | 'failed' | 'aborted';
export type UltraSwarmOutcomeState = 'not_started' | 'running' | 'completed' | 'failed' | 'aborted';
export type UltraSwarmVerdict = 'PASS' | 'BLOCKED' | 'FAIL' | 'ABORTED' | 'SKIPPED';

export function inferVerdict(
  status: UltraSwarmOutcomeStatus,
  text: string,
  state?: UltraSwarmOutcomeState,
): UltraSwarmVerdict {
  if (status === 'failed') return 'FAIL';
  if (status === 'aborted') return state === 'not_started' ? 'SKIPPED' : 'ABORTED';
  const verdictMatch = /\bVERDICT:\s*(PASS|BLOCKED|FAIL)\b/i.exec(text);
  if (verdictMatch?.[1] !== undefined) {
    return verdictMatch[1].toUpperCase() as UltraSwarmVerdict;
  }
  if (/\bBLOCKED\b/i.test(text)) return 'BLOCKED';
  if (/\bFAIL(?:ED)?\b/i.test(text)) return 'FAIL';
  return 'PASS';
}

export function extractEvidenceIds(text: string): readonly string[] {
  const ids = new Set<string>();
  const pattern = /\bevidence(?:[_ -]?ids?)?\s*[:=]\s*([A-Za-z0-9_.:-]+(?:[ ,]+[A-Za-z0-9_.:-]+)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    for (const rawId of match[1]?.split(/[,\s]+/) ?? []) {
      const id = rawId.trim();
      if (id.length > 0) ids.add(id);
    }
  }
  return [...ids];
}

export function resolveMaxExperts(
  toolIntensity: string | undefined,
  routing: { readonly estimatedExperts: number } | undefined,
  explicitMax: number | undefined,
): number {
  if (explicitMax !== undefined) return Math.min(explicitMax, MAX_ULTRA_SWARM_SUBAGENTS);
  if (toolIntensity === 'max') return MAX_ULTRA_SWARM_SUBAGENTS;
  if (toolIntensity === undefined && routing !== undefined) {
    return Math.max(1, Math.min(routing.estimatedExperts, MAX_ULTRA_SWARM_SUBAGENTS));
  }
  return 24;
}


export function withWorkNodeSelectionHint(
  description: string,
  workNodes: readonly WorkGraphNode[],
): string {
  if (workNodes.length === 0) return description;
  const nodeLines = workNodes.map((node) => {
    const lane = node.laneId === undefined ? '' : ` lane=${node.laneId}`;
    const ac = node.acceptanceCriterionId === undefined ? '' : ` ac=${node.acceptanceCriterionId}`;
    return `- ${node.id}${ac}${lane}: ${node.title}`;
  });
  return `${description}\n\nUltrawork WorkGraph nodes:\n${nodeLines.join('\n')}`;
}

export function formatWorkNodeContract(workNodes: readonly WorkGraphNode[]): string {
  const lines = [
    '<work_node_contracts>',
    'You are assigned these UltraworkGraph nodes. Treat the parent UltraGoal and Seed as fixed; do not renegotiate global scope. You may run a local mini-interview only to resolve unknowns inside these assigned nodes. Final answer must start with VERDICT: PASS, VERDICT: BLOCKED, or VERDICT: FAIL and include evidence_ids: ... when evidence exists.',
  ];
  for (const node of workNodes) {
    const fields = [
      `id="${escapeXml(node.id)}"`,
      `status="${escapeXml(node.status)}"`,
      node.kind === undefined ? '' : `kind="${escapeXml(node.kind)}"`,
      node.acceptanceCriterionId === undefined
        ? ''
        : `acceptance_criterion_id="${escapeXml(node.acceptanceCriterionId)}"`,
      node.laneId === undefined ? '' : `lane_id="${escapeXml(node.laneId)}"`,
    ].filter((field) => field.length > 0);
    const requiredEvidence =
      node.requiredEvidence === undefined || node.requiredEvidence.length === 0
        ? ''
        : `\n  Required evidence: ${node.requiredEvidence.join(', ')}`;
    const dependencies =
      node.dependsOn === undefined || node.dependsOn.length === 0
        ? ''
        : `\n  Depends on: ${node.dependsOn.join(', ')}`;
    lines.push(
      `<node ${fields.join(' ')}>\n  Title: ${node.title}${dependencies}${requiredEvidence}\n</node>`,
    );
  }
  lines.push('</work_node_contracts>');
  return lines.join('\n');
}

export function cloneWorkGraphNode(node: WorkGraphNode): WorkGraphNode {
  return {
    id: node.id,
    title: node.title,
    kind: node.kind,
    stage: node.stage,
    parentId: node.parentId,
    acceptanceCriterionId: node.acceptanceCriterionId,
    laneId: node.laneId,
    ownerExpertId: node.ownerExpertId,
    ownerAgentId: node.ownerAgentId,
    status: node.status,
    dependsOn: cloneStringList(node.dependsOn),
    evidenceIds: cloneStringList(node.evidenceIds),
    requiredEvidence: cloneStringList(node.requiredEvidence),
    verificationStatus: node.verificationStatus,
    verificationSummary: node.verificationSummary,
  };
}


export function mergePlans(primary: ExpertSwarmPlan, secondary: ExpertSwarmPlan): ExpertSwarmPlan {
  const seen = new Set<string>();
  const experts: ExpertAssignment[] = [];
  for (const assignment of [...primary.experts, ...secondary.experts]) {
    if (seen.has(assignment.expertId)) continue;
    seen.add(assignment.expertId);
    experts.push(assignment);
  }
  return {
    taskDescription: secondary.taskDescription,
    strategy: experts.length > 3 ? 'mixed' : experts.length > 1 ? 'parallel' : 'sequential',
    experts,
  };
}

export function capPlan(plan: ExpertSwarmPlan, maxExperts: number): ExpertSwarmPlan {
  if (plan.experts.length <= maxExperts) return plan;
  return {
    ...plan,
    experts: plan.experts.slice(0, maxExperts),
    strategy: maxExperts > 3 ? 'mixed' : maxExperts > 1 ? 'parallel' : 'sequential',
  };
}


/** Minimal review-result shape used by pure UltraSwarm merge helpers. */
export interface UltraSwarmReviewResultLike {
  readonly status: string;
  readonly verdict: string;
  readonly spec: {
    readonly expertId: string;
    readonly phase: string;
    readonly requiredForCompletion: boolean;
  };
}

export function needsReviewRetry(result: UltraSwarmReviewResultLike): boolean {
  return (
    result.spec.phase === 'review' &&
    result.spec.requiredForCompletion &&
    result.verdict !== 'PASS' &&
    result.status !== 'aborted'
  );
}

export function mergeReviewResults<T extends UltraSwarmReviewResultLike>(
  original: readonly T[],
  retries: readonly T[],
): T[] {
  const byExpertId = new Map(retries.map((result) => [result.spec.expertId, result]));
  return original.map((result) => byExpertId.get(result.spec.expertId) ?? result);
}

export interface UltraSwarmHandoffResultLike {
  readonly status: string;
  readonly verdict: string;
  readonly result?: string;
  readonly error?: string;
  readonly evidenceIds: readonly string[];
  readonly spec: {
    readonly expertId: string;
    readonly phase: string;
  };
}

export function buildReviewRetryHandoff(results: readonly UltraSwarmHandoffResultLike[]): string {
  const lines = [
    '<review_revision_request>',
    'Council revision pass: address the gaps from your prior review verdict before re-issuing VERDICT.',
  ];
  for (const result of results) {
    lines.push(
      `<prior_review expert_id="${escapeXml(result.spec.expertId)}" verdict="${result.verdict}">${escapeXml(collapseForHandoff(result.result ?? result.error ?? ''))}</prior_review>`,
    );
  }
  lines.push('</review_revision_request>');
  return lines.join('\n');
}

export function buildIntraPhaseDependencyHandoff(
  results: readonly UltraSwarmHandoffResultLike[],
): string {
  if (results.length === 0) return '';
  const lines = ['<dependency_handoff>'];
  for (const result of results) {
    const text = collapseForHandoff(result.result ?? result.error ?? '');
    const evidence =
      result.evidenceIds.length === 0
        ? ''
        : ` evidence_ids="${escapeXml(result.evidenceIds.join(','))}"`;
    lines.push(
      `<upstream expert_id="${escapeXml(result.spec.expertId)}" phase="${result.spec.phase}" verdict="${result.verdict}"${evidence}>${escapeXml(text)}</upstream>`,
    );
  }
  lines.push('</dependency_handoff>');
  return lines.join('\n');
}
