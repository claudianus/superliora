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

export function routeFromPlanSignals(plan: string): SwarmRoutingResult | undefined {
  const decision = ultraSwarmDecision(plan);
  if (decision === undefined) return undefined;

  const explicitIntensityMatch = INTENSITY_REGEX.exec(plan);
  const intensity =
    explicitIntensityMatch?.[1] !== undefined
      ? (explicitIntensityMatch[1].toLowerCase() as SwarmRoutingIntensity)
      : DEFAULT_INTENSITY_BY_DECISION[decision];

  const estimatedExperts = decision === 'DEFER' ? 0 : intensityToDefaultExpertCount(intensity);
  const rationale = RATIONALE_BY_DECISION[decision];

  return { decision, intensity, estimatedExperts, rationale };
}
