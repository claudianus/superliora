export type CriticTargetPhase = 'plan' | 'implement' | 'review';

export interface CriticAssignment {
  readonly criticExpertId: string;
  readonly targetExpertId: string;
  readonly targetExpertName: string;
  readonly targetPhase: CriticTargetPhase;
  readonly targetVerdict: string;
  readonly targetHandoff: string;
  readonly lensId?: string;
  readonly lensAngle?: string;
}

export interface CriticLens {
  readonly lensId: string;
  readonly personaAngle: string;
  readonly temperature: number;
}

export const CRITIC_LENSES: readonly CriticLens[] = [
  {
    lensId: 'spec-strict',
    personaAngle:
      'Review strictly against the acceptance criteria. Check each criterion literally; flag any that is unmet or only partially met.',
    temperature: 0.2,
  },
  {
    lensId: 'adversarial',
    personaAngle:
      'Adopt an adversarial stance: try to prove the work is wrong or incomplete. Hunt for concrete defects, edge cases, and missing evidence before issuing your verdict.',
    temperature: 0.9,
  },
  {
    lensId: 'edge-case',
    personaAngle:
      'Probe boundary conditions and uncommon inputs. Focus on where the work breaks under rare or extreme scenarios.',
    temperature: 0.7,
  },
];

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
  const lensLine = assignment.lensAngle !== undefined && assignment.lensId !== undefined
    ? `\n<review_lens id="${assignment.lensId}">${assignment.lensAngle}</review_lens>`
    : '';
  return [
    '<critic_assignment>',
    `Review as a critic edge for ${assignment.targetExpertName} (${assignment.targetExpertId}) in ${assignment.targetPhase} phase.`,
    `Prior verdict: ${assignment.targetVerdict}.`,
    'Refine or challenge the upstream handoff below; cite concrete gaps before issuing your own VERDICT.',
    '<target_handoff>',
    assignment.targetHandoff,
    '</target_handoff>',
    lensLine,
    '</critic_assignment>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Assign reviewers to sources using diverse critic lenses. Unlike
 * {@link assignReviewCriticEdges} (1:1 round-robin), each source receives up to
 * `lenses.length` independent reviewers — one per lens — so the same artifact
 * is evaluated from multiple angles. Returns a flat list of assignments keyed
 * by `${expertId}` for compatibility with the existing attachment flow.
 */
export function assignDiverseCriticEdges(
  reviewExpertIds: readonly { readonly expertId: string; readonly expertName: string }[],
  sources: readonly CriticReviewSource[],
  lenses: readonly CriticLens[],
): Map<string, CriticAssignment> {
  const assignments = new Map<string, CriticAssignment>();
  if (reviewExpertIds.length === 0 || sources.length === 0 || lenses.length === 0) {
    return assignments;
  }

  const prioritized = [
    ...sources.filter((source) => source.phase === 'implement'),
    ...sources.filter((source) => source.phase === 'plan'),
    ...sources.filter((source) => source.phase !== 'implement' && source.phase !== 'plan'),
  ];
  const targets = prioritized.length > 0 ? prioritized : sources;
  const activeLenses = lenses.length === 1 ? lenses : lenses;

  let reviewerCursor = 0;
  for (let lensIndex = 0; lensIndex < activeLenses.length; lensIndex += 1) {
    const lens = activeLenses[lensIndex];
    if (lens === undefined) continue;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const target = targets[targetIndex];
      if (target === undefined) continue;
      // Cycle reviewers across lens×target so each assignment is a distinct expert.
      const reviewer = reviewExpertIds[reviewerCursor % reviewExpertIds.length];
      reviewerCursor += 1;
      if (reviewer === undefined) continue;
      // Avoid duplicate assignments for the same reviewer on the same target.
      const key = `${reviewer.expertId}`;
      if (assignments.has(key)) continue;
      assignments.set(key, {
        criticExpertId: reviewer.expertId,
        targetExpertId: target.expertId,
        targetExpertName: target.expertName,
        targetPhase: target.phase,
        targetVerdict: target.verdict,
        targetHandoff: target.handoff,
        lensId: lens.lensId,
        lensAngle: lens.personaAngle,
      });
    }
  }

  return assignments;
}
