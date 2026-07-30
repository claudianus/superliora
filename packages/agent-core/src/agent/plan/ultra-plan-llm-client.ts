/**
 * LLM JSON request helpers for Ultra Plan scoring and extraction.
 */

import { createUserMessage } from '@superliora/kosong';

import type { Agent } from '..';
import type { LLMAmbiguityResult } from './ultra-plan-ambiguity-heuristic';
import { extractJsonFromText, extractTextFromLLMResponse } from './ultra-plan-llm-json';
import {
  AMBIGUITY_LLM_SYSTEM_PROMPT,
  buildDriftEvaluationUserPrompt,
  buildSeedSpecExtractionUserPrompt,
  DRIFT_LLM_SYSTEM_PROMPT,
  parseAmbiguityLlmResult,
  parseDriftLlmResult,
  SEED_SPEC_LLM_SYSTEM_PROMPT,
} from './ultra-plan-llm-scoring';
import type { DriftMetrics, SeedSpec } from './ultra-plan-types';

export function isUltraPlanLlmAvailable(agent: Agent): boolean {
  return typeof agent.generate === 'function' && agent.config?.provider !== undefined;
}

export async function ultraPlanLlmJsonRequest<T>(
  agent: Agent,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<T | null> {
  if (!isUltraPlanLlmAvailable(agent)) return null;
  try {
    const response = await agent.generate(
      agent.config.provider,
      system,
      [],
      [createUserMessage(user)],
      undefined,
      { signal },
    );
    const text = extractTextFromLLMResponse(response);
    const json = extractJsonFromText(text);
    if (json === null) return null;
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export async function calculateAmbiguityWithLlm(
  agent: Agent,
  evidence: string,
  signal?: AbortSignal,
): Promise<LLMAmbiguityResult | null> {
  const raw = await ultraPlanLlmJsonRequest<{
    goal_clarity_score?: number;
    goal_clarity_justification?: string;
    constraint_clarity_score?: number;
    constraint_clarity_justification?: string;
    success_criteria_clarity_score?: number;
    success_criteria_clarity_justification?: string;
    present_sections?: unknown;
    verifiable_goal?: boolean;
    specificity_score?: number;
  }>(agent, AMBIGUITY_LLM_SYSTEM_PROMPT, evidence, signal);
  return parseAmbiguityLlmResult(raw);
}

export async function extractSeedSpecWithLlm(
  agent: Agent,
  evidence: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return ultraPlanLlmJsonRequest<unknown>(
    agent,
    SEED_SPEC_LLM_SYSTEM_PROMPT,
    buildSeedSpecExtractionUserPrompt(evidence),
    signal,
  );
}

export async function calculateDriftWithLlm(
  agent: Agent,
  seedSpec: SeedSpec,
  currentOutput: string,
  constraintViolations: string[],
): Promise<DriftMetrics | null> {
  const raw = await ultraPlanLlmJsonRequest<Partial<DriftMetrics>>(
    agent,
    DRIFT_LLM_SYSTEM_PROMPT,
    buildDriftEvaluationUserPrompt(seedSpec, currentOutput, constraintViolations),
  );
  return parseDriftLlmResult(raw);
}
