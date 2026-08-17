/**
 * LLM effect judgment for Job taskTrack.
 *
 * The model judges isolation / mutation / proof — not labels, not keywords.
 * The harness maps that judgment onto coding | general.
 */

import { createUserMessage } from '@superliora/kosong';

import {
  clampConfidence,
  clipClassifierText,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  type LlmClassifierDeps,
} from '../../../utils/llm-classifier-utils';

export { classifierDepsFromAgent } from '../../../utils/llm-classifier-utils';
import type { JobTaskTrack } from './job-store-key';
import {
  resolveJobTaskTrack,
  type ClassifyJobTaskTrackInput,
  type JobTaskTrackResolution,
} from './job-task-track';

export const JOB_TASK_TRACK_CONFIDENCE_FLOOR = 0.55;

export type JobTaskTrackProofKind = 'repo_change' | 'host_observable';

export interface JobTaskTrackEffectJudgment {
  readonly mutatesWorkspace: boolean;
  readonly needsGitIsolation: boolean;
  readonly proofKind: JobTaskTrackProofKind;
  readonly confidence: number;
  readonly rationale: string;
  readonly track: JobTaskTrack;
}

const EFFECT_JUDGE_SYSTEM = [
  'You judge the intended FINISH-LINE EFFECT of a delegated job. Return ONLY compact JSON:',
  '{"mutates_workspace":true,"needs_git_isolation":true,"proof_kind":"repo_change","confidence":0.9,"rationale":"one sentence about the finish-line effect"}',
  '',
  'You are given a done-contract (success criteria, verification commands, surface) plus optional brief context.',
  'Decide what must be true when the job is finished — not what words appear in the title.',
  '',
  'Definitions:',
  '- mutates_workspace: the finish line is a change to this project/workspace (source, tests, in-repo config/docs, or a new product tree).',
  '- needs_git_isolation: the work should be isolated from the operator main checkout (typical when a change may land via review/PR).',
  '- proof_kind=repo_change: done means the workspace changed and can be checked with repo/test/review gates.',
  '- proof_kind=host_observable: done means the host/operator environment changed or ran, and proof is an observable fact outside a product land.',
  '',
  'Rules:',
  '- Reason from the done-contract first. Title and brief are context only.',
  '- Do not classify by matching words or phrases in any language.',
  '- Mixed effects (host action AND workspace change) → mutates_workspace=true, needs_git_isolation=true, proof_kind=repo_change.',
  '- Ambiguous or low confidence → mutates_workspace=true, needs_git_isolation=true, proof_kind=repo_change.',
  '- rationale names the effect (what changes, how it is proven), never quoted trigger words.',
].join('\n');

const inferCache = new Map<string, JobTaskTrackEffectJudgment>();
const INFER_CACHE_MAX = 64;

export function trackFromEffectJudgment(input: {
  readonly mutatesWorkspace: boolean;
  readonly needsGitIsolation: boolean;
  readonly proofKind: JobTaskTrackProofKind;
  readonly confidence: number;
}): JobTaskTrack {
  if (input.confidence < JOB_TASK_TRACK_CONFIDENCE_FLOOR) return 'coding';
  if (input.mutatesWorkspace || input.needsGitIsolation || input.proofKind === 'repo_change') {
    return 'coding';
  }
  if (input.proofKind === 'host_observable') return 'general';
  return 'coding';
}

export function parseJobTaskTrackEffectJudgment(
  text: string,
): JobTaskTrackEffectJudgment | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const mutatesWorkspace = record['mutates_workspace'];
  const needsGitIsolation = record['needs_git_isolation'];
  const proofKindRaw = record['proof_kind'];
  const rationaleRaw = record['rationale'];
  if (typeof mutatesWorkspace !== 'boolean') return undefined;
  if (typeof needsGitIsolation !== 'boolean') return undefined;
  if (proofKindRaw !== 'repo_change' && proofKindRaw !== 'host_observable') return undefined;
  const confidence = clampConfidence(record['confidence']);
  if (confidence === undefined) return undefined;
  const rationale =
    typeof rationaleRaw === 'string' && rationaleRaw.trim().length > 0
      ? rationaleRaw.trim()
      : 'effect judgment';
  const proofKind = proofKindRaw;
  const track = trackFromEffectJudgment({
    mutatesWorkspace,
    needsGitIsolation,
    proofKind,
    confidence,
  });
  return {
    mutatesWorkspace,
    needsGitIsolation,
    proofKind,
    confidence,
    rationale,
    track,
  };
}

/** Structural first; if pending, LLM effect judgment; fail closed to coding when a provider exists but judgment fails. */
export async function resolveJobTaskTrackWithInfer(
  input: ClassifyJobTaskTrackInput,
  deps: LlmClassifierDeps | undefined,
  options?: { readonly signal?: AbortSignal },
): Promise<JobTaskTrackResolution> {
  const resolved = resolveJobTaskTrack(input);
  if (resolved.source !== 'pending') return resolved;
  if (deps === undefined) return { source: 'pending' };
  const judgment = await inferJobTaskTrack(deps, input, options);
  if (judgment === undefined) return { source: 'default', track: 'coding' };
  return { source: 'inferred', track: judgment.track };
}

export async function inferJobTaskTrack(
  deps: LlmClassifierDeps,
  input: ClassifyJobTaskTrackInput,
  options?: { readonly signal?: AbortSignal },
): Promise<JobTaskTrackEffectJudgment | undefined> {
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
    const parsed = parseJobTaskTrackEffectJudgment(extractTextFromGenerateResponse(response));
    if (parsed === undefined) return undefined;
    rememberInfer(cacheKey, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export function clearJobTaskTrackInferCache(): void {
  inferCache.clear();
}

function inferCacheKey(input: ClassifyJobTaskTrackInput): string {
  return [
    input.kind ?? 'task',
    input.deliveryMode ?? '',
    input.surfaceKind ?? '',
    (input.successCriteria ?? []).join('\0'),
    (input.verificationCommands ?? []).join('\0'),
    input.title?.trim() ?? '',
    input.prompt?.trim() ?? '',
    (input.ownershipPaths ?? []).join(','),
    (input.contextPaths ?? []).join(','),
  ].join('\n');
}

function rememberInfer(key: string, value: JobTaskTrackEffectJudgment): void {
  if (inferCache.size >= INFER_CACHE_MAX) {
    const first = inferCache.keys().next().value;
    if (first !== undefined) inferCache.delete(first);
  }
  inferCache.set(key, value);
}

function buildEffectJudgeUserPrompt(input: ClassifyJobTaskTrackInput): string | undefined {
  const title = input.title?.trim() ?? '';
  const prompt = input.prompt?.trim() ?? '';
  const criteria = (input.successCriteria ?? []).map((line) => line.trim()).filter(Boolean);
  const commands = (input.verificationCommands ?? []).map((line) => line.trim()).filter(Boolean);
  if (title.length === 0 && prompt.length === 0 && criteria.length === 0 && commands.length === 0) {
    return undefined;
  }
  const lines = [
    'Judge the intended finish-line effect from the done-contract. Title/brief are context, not a keyword checklist.',
    '',
    `kind: ${input.kind ?? 'task'}`,
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
