/**
 * Pure LLM prompt builders + response parsers for Ultra Plan scoring.
 */

import type { DriftMetrics } from './ultra-plan-mode';
import type { LLMAmbiguityResult } from './ultra-plan-ambiguity-heuristic';

export const AMBIGUITY_LLM_SYSTEM_PROMPT = `You are an expert requirements analyst. Evaluate the clarity of the requirements captured in the interview evidence.

Evaluate three components:
1. Goal Clarity (40%): Is the goal specific and well-defined? Are actors, inputs, and outputs clear?
2. Constraint Clarity (30%): Are constraints, non-goals, failure modes, and runtime context clear?
3. Success Criteria Clarity (30%): Are acceptance criteria, verification plan, and completion criterion measurable?

Score each component from 0.0 (unclear) to 1.0 (perfectly clear).

Also report:
- present_sections: list of section names present in the evidence from [goal, actors, inputs, outputs, constraints, non_goals, acceptance_criteria, verification_plan, failure_modes, runtime_context]
- verifiable_goal: boolean, whether the goal has a clear true/false or pass/fail completion criterion
- specificity_score: 0.0-1.0, how specific the requirements are (files, commands, APIs, concrete paths, etc.)

Respond ONLY with valid JSON. No other text before or after.

{
  "goal_clarity_score": 0.0,
  "goal_clarity_justification": "...",
  "constraint_clarity_score": 0.0,
  "constraint_clarity_justification": "...",
  "success_criteria_clarity_score": 0.0,
  "success_criteria_clarity_justification": "...",
  "present_sections": ["goal"],
  "verifiable_goal": false,
  "specificity_score": 0.0
}`;

export const SEED_SPEC_LLM_SYSTEM_PROMPT =
  'You are an expert planning assistant. Extract a structured Seed Spec from the provided evidence. Return ONLY a JSON object matching the requested schema. Do not wrap it in markdown code fences. Use the same language as the evidence.';

export const DRIFT_LLM_SYSTEM_PROMPT =
  'You are a semantic drift evaluator. Compare the Seed Spec and the current plan/output. Return ONLY a JSON object with goalDrift, constraintDrift, ontologyDrift, each a number 0..1. 0 = perfectly aligned, 1 = completely divergent. Be strict about constraint violations.';

export function buildSeedSpecExtractionUserPrompt(evidence: string): string {
  return [
    'Extract a Seed Spec from the following interview evidence.',
    '',
    'Required JSON schema (omit fields that are empty):',
    JSON.stringify(
      {
        goal: 'string',
        taskType: 'code | research | analysis',
        constraints: ['string'],
        acceptanceCriteria: ['string'],
        ontology: {
          name: 'string',
          description: 'string',
          fields: [{ name: 'string', type: 'string', description: 'string', required: true }],
        },
        evaluationPrinciples: [{ name: 'string', description: 'string', weight: 1.0 }],
        exitConditions: [{ name: 'string', description: 'string', criteria: 'string' }],
        ambiguityScore: 0.15,
      },
      null,
      2,
    ),
    '',
    `Evidence:\n${evidence}`,
  ].join('\n');
}

export function buildDriftEvaluationUserPrompt(
  seedSpec: unknown,
  currentOutput: string,
  constraintViolations: readonly string[],
): string {
  return [
    `Seed Spec:\n${JSON.stringify(seedSpec, null, 2)}`,
    '',
    `Current output/plan:\n${currentOutput}`,
    '',
    `Reported constraint violations:\n${constraintViolations.length > 0 ? constraintViolations.join('\n') : 'none'}`,
    '',
    'Return JSON: { "goalDrift": number, "constraintDrift": number, "ontologyDrift": number }',
  ].join('\n');
}

function clamp01(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function parseAmbiguityLlmResult(raw: {
  goal_clarity_score?: number;
  goal_clarity_justification?: string;
  constraint_clarity_score?: number;
  constraint_clarity_justification?: string;
  success_criteria_clarity_score?: number;
  success_criteria_clarity_justification?: string;
  present_sections?: unknown;
  verifiable_goal?: boolean;
  specificity_score?: number;
} | null): LLMAmbiguityResult | null {
  if (raw === null) return null;
  const presentSections = Array.isArray(raw.present_sections)
    ? raw.present_sections.map((section) => String(section))
    : [];
  return {
    goalClarity: clamp01(raw.goal_clarity_score ?? 0),
    constraintClarity: clamp01(raw.constraint_clarity_score ?? 0),
    successCriteriaClarity: clamp01(raw.success_criteria_clarity_score ?? 0),
    presentSections,
    verifiableGoal: raw.verifiable_goal === true,
    specificityScore: clamp01(raw.specificity_score ?? 0),
    justifications: {
      goal: typeof raw.goal_clarity_justification === 'string' ? raw.goal_clarity_justification : '',
      constraints:
        typeof raw.constraint_clarity_justification === 'string'
          ? raw.constraint_clarity_justification
          : '',
      successCriteria:
        typeof raw.success_criteria_clarity_justification === 'string'
          ? raw.success_criteria_clarity_justification
          : '',
    },
  };
}

export function parseDriftLlmResult(raw: Partial<DriftMetrics> | null): DriftMetrics | null {
  if (raw === null) return null;
  return {
    goalDrift: clamp01(typeof raw.goalDrift === 'number' ? raw.goalDrift : 0),
    constraintDrift: clamp01(typeof raw.constraintDrift === 'number' ? raw.constraintDrift : 0),
    ontologyDrift: clamp01(typeof raw.ontologyDrift === 'number' ? raw.ontologyDrift : 0),
  };
}
