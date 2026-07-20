import { createUserMessage } from '@superliora/kosong';
import type { ChatProvider } from '@superliora/kosong';

import type { Agent } from '../agent';
import type { PremiumInjectionDensity } from '../premium-quality/guidance';
import {
  clipClassifierText,
  clampConfidence,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  validateStringField,
} from './llm-classifier-utils';

export type UltraworkCoverageLaneId =
  | 'product_requirements'
  | 'architecture_implementation'
  | 'domain_subject_matter'
  | 'ux_visual_content'
  | 'security_privacy'
  | 'performance_reliability'
  | 'accessibility_i18n'
  | 'testing_evidence'
  | 'integration_ownership'
  | 'independent_review_loop';

export interface UltraworkObjectiveProfile {
  readonly visualSurface: boolean;
  readonly benchSurface: boolean;
  readonly premiumDensity: PremiumInjectionDensity;
  readonly lanes: readonly UltraworkCoverageLaneId[];
  readonly confidence: number;
  readonly reason: string;
  readonly source: 'llm' | 'fallback';
}

export interface UltraworkObjectiveProfileLlmDeps {
  readonly generate: Agent['generate'];
  readonly provider: ChatProvider;
}

const MIN_CONFIDENCE = 0.55;

const ALWAYS_ON_LANES: readonly UltraworkCoverageLaneId[] = [
  'product_requirements',
  'architecture_implementation',
  'testing_evidence',
  'integration_ownership',
];

const OPTIONAL_LANES: readonly UltraworkCoverageLaneId[] = [
  'domain_subject_matter',
  'ux_visual_content',
  'security_privacy',
  'performance_reliability',
  'accessibility_i18n',
  'independent_review_loop',
];

const ALL_LANES = new Set<string>([...ALWAYS_ON_LANES, ...OPTIONAL_LANES]);

const OBJECTIVE_PROFILE_SYSTEM = `You classify a coding-agent objective for SuperLiora Ultrawork routing.

Return ONLY compact JSON:
{
  "visual_surface": true,
  "bench_surface": false,
  "premium_density": "visual",
  "lanes": ["product_requirements","architecture_implementation","ux_visual_content","testing_evidence","integration_ownership","independent_review_loop"],
  "confidence": 0.9,
  "reason": "short English explanation"
}

Field meanings:
- visual_surface: true when the work has a user-visible UI/UX/game/browser/dashboard/landing surface that needs screenshots or visual craft.
- bench_surface: true when the work is about harness/SOTA/agent-bench/TUI gate/latency-throughput benchmark evidence.
- premium_density: "visual" for user-visible craft work; "code" for backend/CLI/infra/data/API with no visible surface.
- lanes: subset of capability coverage lanes that materially apply. Always include product_requirements, architecture_implementation, testing_evidence, integration_ownership when the objective is real work. Add optional lanes only when justified:
  domain_subject_matter, ux_visual_content, security_privacy, performance_reliability, accessibility_i18n, independent_review_loop.
- independent_review_loop: true/include when subjective quality, multi-lane risk, security, or premium polish needs an independent verdict.
- confidence: 0.0-1.0. Stay below 0.55 when ambiguous.
- reason: one short English sentence for logs.

Rules:
- Judge meaning, not fixed keywords. Any language is fine.
- Prefer fewer optional lanes over speculative ones.
- If the objective is only Q&A/meta, still return a conservative profile with confidence low.`;

/**
 * LLM classifier for Ultrawork objective routing (coverage lanes, prompt surfaces, premium density).
 * Fail-closed callers should fall back via {@link fallbackUltraworkObjectiveProfile}.
 */
export async function detectUltraworkObjectiveProfileWithLlm(
  deps: UltraworkObjectiveProfileLlmDeps,
  input: {
    readonly text: string;
    readonly signal?: AbortSignal;
  },
): Promise<UltraworkObjectiveProfile | undefined> {
  const text = input.text.trim();
  if (text.length === 0) return undefined;

  const clipped = clipClassifierText(text);

  try {
    const response = await deps.generate(
      deps.provider,
      OBJECTIVE_PROFILE_SYSTEM,
      [],
      [
        createUserMessage(
          [
            'Classify this Ultrawork objective for capability routing.',
            '',
            'Objective:',
            clipped,
          ].join('\n'),
        ),
      ],
      undefined,
      { signal: createClassifierTimeoutSignal(undefined, input.signal) },
    );
    return parseProfileResponse(extractTextFromGenerateResponse(response));
  } catch {
    return undefined;
  }
}

export function shouldTrustUltraworkObjectiveProfile(
  profile: UltraworkObjectiveProfile | undefined,
): boolean {
  return profile !== undefined && profile.confidence >= MIN_CONFIDENCE;
}

/**
 * Keyword-free structural fallback used when the LLM is unavailable or low-confidence.
 * Always-on work lanes only; no domain/visual/bench keyword guessing.
 */
export function fallbackUltraworkObjectiveProfile(
  objective: string,
  reason = 'LLM objective profile unavailable; using structural fallback',
): UltraworkObjectiveProfile {
  const text = objective.trim();
  if (text.length === 0) {
    return {
      visualSurface: false,
      benchSurface: false,
      premiumDensity: 'visual',
      lanes: ALWAYS_ON_LANES,
      confidence: 0,
      reason: 'Empty objective',
      source: 'fallback',
    };
  }
  return {
    visualSurface: false,
    benchSurface: false,
    premiumDensity: 'code',
    lanes: ALWAYS_ON_LANES,
    confidence: 0,
    reason,
    source: 'fallback',
  };
}

export function resolveUltraworkObjectiveProfile(
  profile: UltraworkObjectiveProfile | undefined,
  objective: string,
): UltraworkObjectiveProfile {
  if (shouldTrustUltraworkObjectiveProfile(profile) && profile !== undefined) {
    return profile;
  }
  return fallbackUltraworkObjectiveProfile(objective, profile?.reason);
}

function parseProfileResponse(text: string): UltraworkObjectiveProfile | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const visualSurface = record['visual_surface'];
  const benchSurface = record['bench_surface'];
  const premiumDensity = record['premium_density'];
  const lanesRaw = record['lanes'];
  const confidence = clampConfidence(record['confidence']);
  const reason = validateStringField(record['reason']);
  if (typeof visualSurface !== 'boolean') return undefined;
  if (typeof benchSurface !== 'boolean') return undefined;
  if (premiumDensity !== 'visual' && premiumDensity !== 'code') return undefined;
  if (!Array.isArray(lanesRaw)) return undefined;
  if (confidence === undefined) return undefined;
  if (reason === undefined) return undefined;

  const optional = lanesRaw
    .filter((lane): lane is string => typeof lane === 'string')
    .map((lane) => lane.trim())
    .filter((lane): lane is UltraworkCoverageLaneId => ALL_LANES.has(lane));

  const lanes = uniqueLanes([
    ...ALWAYS_ON_LANES,
    ...optional,
    ...(visualSurface ? (['ux_visual_content'] as const) : []),
    ...(visualSurface || optional.includes('security_privacy') || optional.includes('domain_subject_matter')
      ? (['independent_review_loop'] as const)
      : []),
  ]);

  return {
    visualSurface,
    benchSurface,
    premiumDensity,
    lanes,
    confidence,
    reason,
    source: 'llm',
  };
}

function uniqueLanes(lanes: readonly UltraworkCoverageLaneId[]): readonly UltraworkCoverageLaneId[] {
  const seen = new Set<UltraworkCoverageLaneId>();
  const out: UltraworkCoverageLaneId[] = [];
  for (const lane of lanes) {
    if (seen.has(lane)) continue;
    seen.add(lane);
    out.push(lane);
  }
  return out;
}
