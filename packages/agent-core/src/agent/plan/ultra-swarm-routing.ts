import { ultraSwarmDecision } from './ultra-swarm-decision';

export type SwarmRoutingIntensity = 'light' | 'standard' | 'heavy';

export interface SwarmRoutingResult {
  readonly decision: 'ENGAGE' | 'ADAPTIVE' | 'DEFER';
  readonly intensity: SwarmRoutingIntensity;
  readonly estimatedExperts: number;
  readonly rationale: string;
}

const INTENSITY_REGEX = /\bswarm intensity\s*:\s*(light|standard|heavy)\b/i;

const INTENSITY_EXPERT_COUNT: Record<SwarmRoutingIntensity, number> = {
  light: 4,
  standard: 12,
  heavy: 24,
};

export function intensityToDefaultExpertCount(intensity: SwarmRoutingIntensity): number {
  return INTENSITY_EXPERT_COUNT[intensity];
}

const DEFAULT_INTENSITY_BY_DECISION = {
  ENGAGE: 'heavy' as const,
  ADAPTIVE: 'standard' as const,
  DEFER: 'light' as const,
};

const RATIONALE_BY_DECISION = {
  ENGAGE: 'Multi-lane or review-heavy work warrants a full specialist swarm.',
  ADAPTIVE: 'Moderate complexity: a scaled-down swarm with focused specialists.',
  DEFER: 'Single-owner or deterministic task; a single agent suffices.',
};

const SWARM_OVERRIDE_REGEX = /--swarm|force swarm\s*:\s*yes\b/i;

export function routeFromPlanSignals(plan: string): SwarmRoutingResult | undefined {
  const decision = ultraSwarmDecision(plan);
  if (decision === undefined) return undefined;

  // Escape hatch: a DEFER can be upgraded to a scaled-down ADAPTIVE swarm
  // when the user explicitly forces it via --swarm / "Force Swarm: yes".
  const upgradedFromDefer = decision === 'DEFER' && SWARM_OVERRIDE_REGEX.test(plan);
  const effectiveDecision = upgradedFromDefer ? 'ADAPTIVE' : decision;

  const explicitIntensityMatch = INTENSITY_REGEX.exec(plan);
  const defaultIntensity = upgradedFromDefer ? 'standard' : DEFAULT_INTENSITY_BY_DECISION[decision];
  const intensity =
    explicitIntensityMatch?.[1] !== undefined
      ? (explicitIntensityMatch[1].toLowerCase() as SwarmRoutingIntensity)
      : defaultIntensity;

  const estimatedExperts =
    effectiveDecision === 'DEFER' ? 0 : intensityToDefaultExpertCount(intensity);
  const rationale = RATIONALE_BY_DECISION[effectiveDecision];

  return { decision: effectiveDecision, intensity, estimatedExperts, rationale };
}
