import type { Agent } from '../../../agent';
import { globalUltraSwarmOrchestrator } from '../../../expert-agents/orchestrator';
import { synthesizeExpertsWithLlm } from '../../../expert-agents/synthetic-expert-llm';
import type { ExpertSwarmPlan } from '../../../expert-agents/types';
import { capPlan, mergePlans, planFromSyntheticExperts } from './ultra-swarm-helpers';
import type { UltraSwarmToolInput } from './ultra-swarm-schema';

export async function buildUltraSwarmExpertPlan(
  description: string,
  autoSelect: boolean,
  requestedExperts: readonly string[],
  maxExperts: number,
  intensity: UltraSwarmToolInput['intensity'],
): Promise<ExpertSwarmPlan> {
  const base = await globalUltraSwarmOrchestrator.buildSwarmPlan(
    description,
    autoSelect ? undefined : requestedExperts,
    { intensity, maxExperts },
  );
  if (autoSelect && requestedExperts.length > 0) {
    const required = await globalUltraSwarmOrchestrator.buildSwarmPlan(
      description,
      requestedExperts,
      { intensity, maxExperts },
    );
    return capPlan(mergePlans(required, base), maxExperts);
  }
  return capPlan(base, maxExperts);
}

/**
 * When the static catalog cannot staff the task, ask the active model to
 * invent high-quality specialist personas and register them for spawn.
 */
export async function synthesizeUltraSwarmFallbackPlan(
  agent: Agent,
  input: {
    readonly description: string;
    readonly intensity: UltraSwarmToolInput['intensity'];
    readonly maxExperts: number;
    readonly signal: AbortSignal;
  },
): Promise<ExpertSwarmPlan> {
  const experts = await synthesizeExpertsWithLlm(
    {
      generate: agent.generate,
      provider: agent.config.provider,
    },
    {
      taskDescription: input.description,
      intensity: input.intensity,
      count: Math.min(
        input.maxExperts,
        input.intensity === 'max' ? 3 : input.intensity === 'premium' ? 2 : 1,
      ),
      signal: input.signal,
    },
  );
  if (experts.length === 0) {
    return { taskDescription: input.description, experts: [], strategy: 'sequential' };
  }
  return capPlan(planFromSyntheticExperts(input.description, experts), input.maxExperts);
}
