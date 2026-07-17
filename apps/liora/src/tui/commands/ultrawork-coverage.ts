/** Ultrawork capability coverage matrix — lanes come from LLM objective profiles. */

export interface UltraworkCoverageLane {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly evidenceNeeded: readonly string[];
  readonly owner: string;
}

export interface UltraworkCoverageProfileInput {
  readonly lanes?: readonly string[];
  readonly visualSurface?: boolean;
  readonly benchSurface?: boolean;
}

const LANE_CATALOG: Readonly<Record<string, Omit<UltraworkCoverageLane, 'id'>>> = {
  product_requirements: {
    label: 'Product / requirements',
    reason:
      'The UltraGoal needs explicit scope, non-goals, acceptance criteria, and user-visible completion criteria.',
    evidenceNeeded: ['UltraGoal seed', 'AC Tree', 'Acceptance Criteria', 'non-goals'],
    owner: 'main integration owner',
  },
  architecture_implementation: {
    label: 'Architecture / implementation',
    reason: 'The work changes or creates executable behavior that needs a concrete implementation plan.',
    evidenceNeeded: ['affected files', 'implementation plan', 'focused tests or runnable checks'],
    owner: 'implementation owner',
  },
  domain_subject_matter: {
    label: 'Domain subject matter',
    reason: 'The goal depends on domain-specific rules, terminology, or quality expectations.',
    evidenceNeeded: ['domain assumptions', 'source or observed behavior references', 'domain review verdict'],
    owner: 'domain specialist',
  },
  ux_visual_content: {
    label: 'UX / visual / content craft',
    reason: 'The result has a visible or subjective quality bar that cannot be proven by code inspection alone.',
    evidenceNeeded: ['screenshot or recording', 'visual target', 'reviewer verdict'],
    owner: 'UX or visual reviewer',
  },
  security_privacy: {
    label: 'Security / privacy',
    reason: 'The work may affect credentials, permissions, privacy, payment, or compliance behavior.',
    evidenceNeeded: ['threat or privacy notes', 'secret scan', 'negative tests or permission proof'],
    owner: 'security reviewer',
  },
  performance_reliability: {
    label: 'Performance / reliability',
    reason: 'The goal includes runtime quality, stability, or performance expectations.',
    evidenceNeeded: ['benchmark or timing evidence', 'failure mode notes', 'bounded retry behavior'],
    owner: 'performance reviewer',
  },
  accessibility_i18n: {
    label: 'Accessibility / internationalization',
    reason: 'The result may need language, accessibility, viewport, or localization checks.',
    evidenceNeeded: [
      'keyboard/screen-reader notes when applicable',
      'language copy review',
      'responsive evidence',
    ],
    owner: 'accessibility or localization reviewer',
  },
  testing_evidence: {
    label: 'Testing / evidence',
    reason: 'Completion must be backed by mechanical checks or explicit runtime evidence.',
    evidenceNeeded: ['test output', 'typecheck/lint/build status', 'runtime observation path'],
    owner: 'verification owner',
  },
  integration_ownership: {
    label: 'Integration ownership',
    reason: 'Specialist feedback must be merged into one coherent implementation and final verdict.',
    evidenceNeeded: ['integration notes', 'conflict resolution', 'final PASS/BLOCKED rationale'],
    owner: 'main integration owner',
  },
  independent_review_loop: {
    label: 'Independent review loop',
    reason: 'At least one acceptance criterion requires an independent verdict before completion.',
    evidenceNeeded: [
      'review prompt',
      'review verdict',
      'fix-and-review iteration notes until PASS or explicit BLOCKED',
    ],
    owner: 'independent reviewer',
  },
};

const ALWAYS_ON_LANE_IDS = [
  'product_requirements',
  'architecture_implementation',
  'testing_evidence',
  'integration_ownership',
] as const;

/**
 * Build the capability coverage matrix from an LLM objective profile.
 * Keyword heuristics are intentionally gone — without a profile only always-on lanes remain.
 */
export function buildUltraworkCoverageMatrix(
  _objective: string,
  profile?: UltraworkCoverageProfileInput,
): readonly UltraworkCoverageLane[] {
  const requested = new Set<string>([
    ...ALWAYS_ON_LANE_IDS,
    ...(profile?.lanes ?? []),
    ...(profile?.visualSurface === true ? ['ux_visual_content', 'independent_review_loop'] : []),
  ]);

  const lanes: UltraworkCoverageLane[] = [];
  for (const id of requested) {
    const catalog = LANE_CATALOG[id];
    if (catalog === undefined) continue;
    if (lanes.some((entry) => entry.id === id)) continue;
    lanes.push({ id, ...catalog });
  }
  return lanes;
}
