import type { SeedWorkGraphFromPlanResult } from './work-graph-from-plan';

export type UltraSwarmDecision = 'ENGAGE' | 'DEFER';

export function ultraSwarmDecision(plan: string): UltraSwarmDecision | undefined {
  const lineMatch = /\bswarm decision\s*:\s*(ENGAGE|DEFER)\b/i.exec(plan);
  if (lineMatch?.[1] !== undefined) return lineMatch[1].toUpperCase() as UltraSwarmDecision;
  const fieldMatch =
    /^\s*(?:[-*+•]|\d+[.)])?\s*(?:\*\*)?Decision(?:\*\*)?\s*:\s*(ENGAGE|DEFER)\b/im.exec(plan);
  if (fieldMatch?.[1] !== undefined) return fieldMatch[1].toUpperCase() as UltraSwarmDecision;
  return undefined;
}

export function ultraSwarmEngageNextAction(
  plan: string,
  seededWorkGraph: SeedWorkGraphFromPlanResult = { seeded: false, nodeIds: [] },
): string | undefined {
  if (ultraSwarmDecision(plan) !== 'ENGAGE') return undefined;
  const workNodeLine = seededWorkGraph.seeded && seededWorkGraph.nodeIds.length > 0
    ? `Approved plan WorkGraph nodes are already seeded; pass work_node_ids: ${seededWorkGraph.nodeIds.join(', ')}.`
    : 'Pass relevant UltraworkGraph work_node_ids after seeding the graph, or omit work_node_ids until UltraworkGraph exists.';
  return [
    'UltraSwarm ENGAGE is binding.',
    'Next action: create the verifiable UltraGoal with CreateGoal if it does not already exist, then call UltraSwarm as the only tool call before product-file edits or single-agent implementation.',
    workNodeLine,
    'Pass the Capability Coverage Matrix, acceptance criteria, risks, required evidence, and verification owner in the UltraSwarm description.',
    'If specialists are no longer needed, revise the Swarm decision to DEFER with a waiver before implementation.',
  ].join(' ');
}
