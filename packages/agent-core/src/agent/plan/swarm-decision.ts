import type { SeedWorkGraphFromPlanResult } from './work-graph-from-plan';

/**
 * Plan-level "Swarm decision" signal parsing for the Ultra Plan contract.
 *
 * The UltraSwarm runtime was retired in S3-R4 (inventory B-2); what remains
 * here is the plan-text signal plus the ENGAGE next-action hint, which now
 * routes approved plans to Job worker fan-out instead of a swarm run.
 */
export type PlanSwarmDecision = 'ENGAGE' | 'ADAPTIVE' | 'DEFER';

export function planSwarmDecision(plan: string): PlanSwarmDecision | undefined {
  const lineMatch = /\bswarm decision\s*:\s*(ENGAGE|ADAPTIVE|DEFER)\b/i.exec(plan);
  if (lineMatch?.[1] !== undefined) return lineMatch[1].toUpperCase() as PlanSwarmDecision;
  const fieldMatch =
    /^\s*(?:[-*+•]|\d+[.)])?\s*(?:\*\*)?Decision(?:\*\*)?\s*:\s*(ENGAGE|ADAPTIVE|DEFER)\b/im.exec(plan);
  if (fieldMatch?.[1] !== undefined) return fieldMatch[1].toUpperCase() as PlanSwarmDecision;
  return undefined;
}

export function planSwarmEngageNextAction(
  plan: string,
  seededWorkGraph: SeedWorkGraphFromPlanResult = { seeded: false, nodeIds: [] },
): string | undefined {
  if (planSwarmDecision(plan) !== 'ENGAGE') return undefined;
  const workNodeLine = seededWorkGraph.seeded && seededWorkGraph.nodeIds.length > 0
    ? `Approved plan WorkGraph nodes are already seeded; pass work_node_ids: ${seededWorkGraph.nodeIds.join(', ')}.`
    : 'Pass relevant UltraworkGraph work_node_ids after seeding the graph, or omit work_node_ids until UltraworkGraph exists.';
  return [
    'Swarm ENGAGE approved.',
    'Recommended next action: create the verifiable UltraGoal with CreateGoal if it does not already exist, then fan the work out to Job workers (JobCreate) before product-file edits or single-agent implementation.',
    workNodeLine,
    'Pass the capability coverage matrix, acceptance criteria, risks, required evidence, and verification owner in the job descriptions.',
    'If specialists are no longer needed, revise the Swarm decision to DEFER with a waiver before implementation.',
  ].join(' ');
}
