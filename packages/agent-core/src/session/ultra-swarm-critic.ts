export type CriticTargetPhase = 'plan' | 'implement' | 'review';

export interface CriticAssignment {
  readonly criticExpertId: string;
  readonly targetExpertId: string;
  readonly targetExpertName: string;
  readonly targetPhase: CriticTargetPhase;
  readonly targetVerdict: string;
  readonly targetHandoff: string;
}

export interface CriticReviewSource {
  readonly expertId: string;
  readonly expertName: string;
  readonly phase: CriticTargetPhase;
  readonly verdict: string;
  readonly handoff: string;
}

export function assignReviewCriticEdges(
  reviewExpertIds: readonly { readonly expertId: string; readonly expertName: string }[],
  sources: readonly CriticReviewSource[],
): Map<string, CriticAssignment> {
  const assignments = new Map<string, CriticAssignment>();
  if (reviewExpertIds.length === 0 || sources.length === 0) return assignments;

  const prioritized = [
    ...sources.filter((source) => source.phase === 'implement'),
    ...sources.filter((source) => source.phase === 'plan'),
    ...sources.filter((source) => source.phase !== 'implement' && source.phase !== 'plan'),
  ];
  const targets = prioritized.length > 0 ? prioritized : sources;

  for (let index = 0; index < reviewExpertIds.length; index += 1) {
    const reviewer = reviewExpertIds[index];
    if (reviewer === undefined) continue;
    const target = targets[index % targets.length];
    if (target === undefined) continue;
    assignments.set(reviewer.expertId, {
      criticExpertId: reviewer.expertId,
      targetExpertId: target.expertId,
      targetExpertName: target.expertName,
      targetPhase: target.phase,
      targetVerdict: target.verdict,
      targetHandoff: target.handoff,
    });
  }

  return assignments;
}

export function buildCriticAssignmentXml(assignment: CriticAssignment): string {
  return [
    '<critic_assignment>',
    `Review as a critic edge for ${assignment.targetExpertName} (${assignment.targetExpertId}) in ${assignment.targetPhase} phase.`,
    `Prior verdict: ${assignment.targetVerdict}.`,
    'Refine or challenge the upstream handoff below; cite concrete gaps before issuing your own VERDICT.',
    '<target_handoff>',
    assignment.targetHandoff,
    '</target_handoff>',
    '</critic_assignment>',
  ].join('\n');
}
