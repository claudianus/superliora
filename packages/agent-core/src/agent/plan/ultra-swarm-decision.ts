export type UltraSwarmDecision = 'ENGAGE' | 'DEFER';

export function ultraSwarmDecision(plan: string): UltraSwarmDecision | undefined {
  const lineMatch = /\bswarm decision\s*:\s*(ENGAGE|DEFER)\b/i.exec(plan);
  if (lineMatch?.[1] !== undefined) return lineMatch[1].toUpperCase() as UltraSwarmDecision;
  const fieldMatch =
    /^\s*(?:[-*+•]|\d+[.)])?\s*(?:\*\*)?Decision(?:\*\*)?\s*:\s*(ENGAGE|DEFER)\b/im.exec(plan);
  if (fieldMatch?.[1] !== undefined) return fieldMatch[1].toUpperCase() as UltraSwarmDecision;
  return undefined;
}

export function ultraSwarmEngageNextAction(plan: string): string | undefined {
  if (ultraSwarmDecision(plan) !== 'ENGAGE') return undefined;
  return [
    'UltraSwarm ENGAGE is binding.',
    'Next action: call UltraSwarm as the only tool call before product-file edits or single-agent implementation.',
    'Pass the Capability Coverage Matrix, acceptance criteria, risks, required evidence, verification owner, and relevant UltraworkGraph work_node_ids.',
    'If specialists are no longer needed, revise the Swarm decision to DEFER with a waiver before implementation.',
  ].join(' ');
}
