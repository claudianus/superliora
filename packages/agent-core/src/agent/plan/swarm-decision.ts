/**
 * Swarm decision parsing and ENGAGE follow-up advice for approved plans.
 *
 * Ultra Plan keeps the "Swarm decision" section. The retired fan-out tools and their
 * engage gate are retired, so an ENGAGE decision now routes into Job worker
 * fan-out (Job ledger) instead of a specialist swarm tool.
 */
import type { SeedWorkGraphFromPlanResult } from './work-graph-from-plan';

export type SwarmDecision = 'ENGAGE' | 'ADAPTIVE' | 'DEFER';

export function swarmDecisionFromPlan(plan: string): SwarmDecision | undefined {
  const lineMatch = /\bswarm decision\s*:\s*(ENGAGE|ADAPTIVE|DEFER)\b/i.exec(plan);
  if (lineMatch?.[1] !== undefined) return lineMatch[1].toUpperCase() as SwarmDecision;
  const fieldMatch =
    /^\s*(?:[-*+•]|\d+[.)])?\s*(?:\*\*)?Decision(?:\*\*)?\s*:\s*(ENGAGE|ADAPTIVE|DEFER)\b/im.exec(plan);
  if (fieldMatch?.[1] !== undefined) return fieldMatch[1].toUpperCase() as SwarmDecision;
  return undefined;
}

export function swarmEngageNextAction(
  plan: string,
  seededWorkGraph: SeedWorkGraphFromPlanResult = { seeded: false, nodeIds: [] },
): string | undefined {
  if (swarmDecisionFromPlan(plan) !== 'ENGAGE') return undefined;
  const workNodeLine = seededWorkGraph.seeded && seededWorkGraph.nodeIds.length > 0
    ? `Approved plan WorkGraph nodes are already seeded; pass work_node_ids: ${seededWorkGraph.nodeIds.join(', ')}.`
    : 'Pass relevant TaskGraph work_node_ids after seeding the graph, or omit work_node_ids until TaskGraph exists.';
  return [
    'Swarm ENGAGE approved.',
    'Recommended next action: create the verifiable UltraGoal with CreateGoal if it does not already exist, then fan the work out to Job workers (JobCreate) before product-file edits or single-agent implementation.',
    workNodeLine,
    'Pass the capability coverage matrix, acceptance criteria, risks, required evidence, and verification owner in the job descriptions.',
    'If specialists are no longer needed, revise the Swarm decision to DEFER with a waiver before implementation.',
  ].join(' ');
}