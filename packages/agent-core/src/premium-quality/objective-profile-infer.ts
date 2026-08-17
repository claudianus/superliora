/**
 * LLM effect judgment for Premium density / vision spawn.
 *
 * The model judges whether the finish line has a user-visible surface —
 * not labels, not title keywords, not path-extension cookbooks.
 */

import { createUserMessage } from '@superliora/kosong';

import {
  clampConfidence,
  clipClassifierText,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  type LlmClassifierDeps,
} from '../utils/llm-classifier-utils';
import {
  classifyObjectiveProfile,
  type ObjectiveProfile,
  type ObjectiveSurfaceKind,
} from './ui-surface';

export const OBJECTIVE_PROFILE_CONFIDENCE_FLOOR = 0.55;

export interface ObjectiveSurfaceJudgment {
  readonly userVisibleSurface: boolean;
  readonly needsScreenshotProof: boolean;
  readonly confidence: number;
  readonly rationale: string;
  readonly profile: ObjectiveProfile;
}

export interface InferObjectiveProfileInput {
  readonly objective?: string;
  readonly title?: string;
  readonly prompt?: string;
  readonly successCriteria?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly surfaceKind?: ObjectiveSurfaceKind;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
}

const EFFECT_JUDGE_SYSTEM = [
  'You judge whether a task finish line has a USER-VISIBLE SURFACE. Return ONLY compact JSON:',
  '{"user_visible_surface":true,"needs_screenshot_proof":true,"confidence":0.9,"rationale":"one sentence about the finish-line surface"}',
  '',
  'You are given a done-contract (success criteria, verification, declared surface) plus optional brief context.',
  'Decide what humans will see when the work is finished — not what words appear in the title.',
  '',
  'Definitions:',
  '- user_visible_surface: the deliverable changes pixels or interaction a person looks at (web, TUI, game, marketing page, app chrome).',
  '- needs_screenshot_proof: done should be proven with a real-surface capture, not only unit tests or logs.',
  '',
  'Rules:',
  '- Reason from the done-contract first. Title and brief are context only.',
  '- Do not classify by matching words or phrases in any language.',
  '- Backend, CLI, infra, protocol, or test-only finish lines → both false.',
  '- Mixed (visible surface AND backend) → both true.',
  '- Ambiguous or low confidence → both false.',
  '- rationale names the surface effect, never quoted trigger words.',
].join('\n');

const inferCache = new Map<string, ObjectiveSurfaceJudgment>();
const INFER_CACHE_MAX = 64;

export function profileFromSurfaceJudgment(input: {
  readonly userVisibleSurface: boolean;
  readonly needsScreenshotProof: boolean;
  readonly confidence: number;
}): ObjectiveProfile {
  if (input.confidence < OBJECTIVE_PROFILE_CONFIDENCE_FLOOR) {
    return { premiumDensity: 'code', visualSurface: false };
  }
  if (input.userVisibleSurface || input.needsScreenshotProof) {
    return { premiumDensity: 'visual', visualSurface: true };
  }
  return { premiumDensity: 'code', visualSurface: false };
}

export function parseObjectiveSurfaceJudgment(
  text: string,
): ObjectiveSurfaceJudgment | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const userVisibleSurface = record['user_visible_surface'];
  const needsScreenshotProof = record['needs_screenshot_proof'];
  const rationaleRaw = record['rationale'];
  if (typeof userVisibleSurface !== 'boolean') return undefined;
  if (typeof needsScreenshotProof !== 'boolean') return undefined;
  const confidence = clampConfidence(record['confidence']);
  if (confidence === undefined) return undefined;
  const rationale =
    typeof rationaleRaw === 'string' && rationaleRaw.trim().length > 0
      ? rationaleRaw.trim()
      : 'surface judgment';
  const profile = profileFromSurfaceJudgment({
    userVisibleSurface,
    needsScreenshotProof,
    confidence,
  });
  return {
    userVisibleSurface,
    needsScreenshotProof,
    confidence,
    rationale,
    profile,
  };
}

/** Declared surface_kind first; else LLM; fail closed to code when judgment fails. */
export async function resolveObjectiveProfileWithInfer(
  input: InferObjectiveProfileInput,
  deps: LlmClassifierDeps | undefined,
  options?: { readonly signal?: AbortSignal },
): Promise<ObjectiveProfile> {
  const declared = classifyObjectiveProfile(input.objective, {
    surfaceKind: input.surfaceKind,
  });
  if (input.surfaceKind !== undefined) return declared;
  if (deps === undefined) {
    const text = input.objective?.trim() ?? '';
    if (text.length === 0) return declared;
    return { premiumDensity: 'code', visualSurface: false };
  }
  const judgment = await inferObjectiveProfile(deps, input, options);
  if (judgment === undefined) return { premiumDensity: 'code', visualSurface: false };
  return judgment.profile;
}

export async function inferObjectiveProfile(
  deps: LlmClassifierDeps,
  input: InferObjectiveProfileInput,
  options?: { readonly signal?: AbortSignal },
): Promise<ObjectiveSurfaceJudgment | undefined> {
  const cacheKey = inferCacheKey(input);
  const cached = inferCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const user = buildEffectJudgeUserPrompt(input);
  if (user === undefined) return undefined;

  try {
    const response = await deps.generate(
      deps.provider,
      EFFECT_JUDGE_SYSTEM,
      [],
      [createUserMessage(user)],
      undefined,
      { signal: createClassifierTimeoutSignal(10_000, options?.signal) },
    );
    const parsed = parseObjectiveSurfaceJudgment(extractTextFromGenerateResponse(response));
    if (parsed === undefined) return undefined;
    rememberInfer(cacheKey, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export function clearObjectiveProfileInferCache(): void {
  inferCache.clear();
}

function inferCacheKey(input: InferObjectiveProfileInput): string {
  return [
    input.surfaceKind ?? '',
    (input.successCriteria ?? []).join('\0'),
    (input.verificationCommands ?? []).join('\0'),
    input.objective?.trim() ?? '',
    input.title?.trim() ?? '',
    input.prompt?.trim() ?? '',
    (input.ownershipPaths ?? []).join(','),
    (input.contextPaths ?? []).join(','),
  ].join('\n');
}

function rememberInfer(key: string, value: ObjectiveSurfaceJudgment): void {
  if (inferCache.size >= INFER_CACHE_MAX) {
    const first = inferCache.keys().next().value;
    if (first !== undefined) inferCache.delete(first);
  }
  inferCache.set(key, value);
}

function buildEffectJudgeUserPrompt(input: InferObjectiveProfileInput): string | undefined {
  const objective = input.objective?.trim() ?? '';
  const title = input.title?.trim() ?? '';
  const prompt = input.prompt?.trim() ?? '';
  const criteria = (input.successCriteria ?? []).map((line) => line.trim()).filter(Boolean);
  const commands = (input.verificationCommands ?? []).map((line) => line.trim()).filter(Boolean);
  if (
    objective.length === 0 &&
    title.length === 0 &&
    prompt.length === 0 &&
    criteria.length === 0 &&
    commands.length === 0
  ) {
    return undefined;
  }
  const lines = [
    'Judge whether the finish line has a user-visible surface. Title/brief are context, not a keyword checklist.',
    '',
  ];
  if (input.surfaceKind !== undefined) lines.push(`surface_kind: ${input.surfaceKind}`);
  if (criteria.length > 0) {
    lines.push('success_criteria:');
    for (const line of criteria) lines.push(`- ${clipClassifierText(line, 400)}`);
  }
  if (commands.length > 0) {
    lines.push('verification_commands:');
    for (const line of commands) lines.push(`- ${clipClassifierText(line, 400)}`);
  }
  if (objective.length > 0) lines.push(`objective: ${clipClassifierText(objective)}`);
  if (title.length > 0) lines.push(`title: ${clipClassifierText(title)}`);
  if (prompt.length > 0) lines.push(`brief: ${clipClassifierText(prompt)}`);
  if ((input.ownershipPaths ?? []).length > 0) {
    lines.push(`ownership_paths: ${input.ownershipPaths!.join(', ')}`);
  }
  if ((input.contextPaths ?? []).length > 0) {
    lines.push(`context_paths: ${input.contextPaths!.join(', ')}`);
  }
  return lines.join('\n');
}
