/**
 * LLM risk judgment for MergeJob trust (H6 phase 2).
 *
 * The model judges whether a change is risky, which of the reported paths are
 * sensitive, and whether the change is wide. The harness keeps the mechanical
 * half: merge execution, conflict detection, file writes, checksums, exit-code
 * preservation, and path normalization.
 *
 * A project/operator declaration always wins over the judgment. When neither a
 * declaration nor a judgment is available the verdict is `undecidable` — the
 * caller must record it and hold. There is no silent pass.
 */

import { createUserMessage } from '@superliora/kosong';

import {
  clampConfidence,
  classifierDepsFromAgent,
  clipClassifierText,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  type LlmClassifierDeps,
} from '../../../../utils/llm-classifier-utils';

export { classifierDepsFromAgent };

export interface MergeRiskJudgment {
  /** True when landing this change without a human click would be unsafe. */
  readonly risky: boolean;
  /** Paths the model judges sensitive (secrets, prod infra, CI, lockfiles…). */
  readonly sensitivePaths: readonly string[];
  /** True when the change is too wide to review unattended. */
  readonly wideChange: boolean;
  readonly confidence: number;
  readonly rationale: string;
}

/** Judgment slot: a real judgment, or an explicit "could not judge". */
export type MergeRiskAssessment = MergeRiskJudgment | 'undecidable';

export const MERGE_RISK_CONFIDENCE_FLOOR = 0.5;

const RISK_JUDGE_SYSTEM = [
  'You judge whether landing a change into the main branch without a human click is safe.',
  'Return ONLY compact JSON:',
  '{"risky":false,"sensitive_paths":[],"wide_change":false,"confidence":0.9,"rationale":"one sentence"}',
  '',
  'Definitions:',
  '- risky: the change can destroy data, leak secrets, alter credentials/CI/deploy behavior, or is otherwise hard to undo. Judge the effect, not the filename.',
  '- sensitive_paths: copy the EXACT path strings from the provided list that this judgment covers. Never invent paths that were not given.',
  '- wide_change: the change is too large or too broadly scoped to review unattended (touches many unrelated areas, or is a rewrite rather than an edit).',
  '- confidence: 0..1. Use < 0.5 when the evidence is insufficient to judge.',
  '',
  'Rules:',
  '- Reason from the change effect (paths, stated size, diff summary) — not from words appearing in a filename.',
  '- A path whose NAME looks alarming but whose role is benign (docs about secrets, test fixtures, examples, mocks) is NOT sensitive.',
  '- A path whose name looks benign but whose role is destructive (prod deploy, migration applied on live data, credential rotation) IS sensitive.',
  '- A large line count is not by itself a reason to be risky; a small change to an authorisation check can be risky.',
  '- When you cannot judge from the given evidence, set confidence below 0.5 and say so in rationale.',
].join('\n');

interface MergeRiskJudgeInput {
  readonly paths?: readonly string[];
  /** Self-reported diff size, if the caller supplied one. */
  readonly diffLines?: number;
  readonly summary?: string;
  readonly title?: string;
  readonly jobKind?: string;
}

/**
 * Mechanical: canonicalize a path for exact comparison. No guessing about
 * meaning — only separator/prefix normalization.
 */
function normalizeMergePath(path: string): string {
  return path.trim().replaceAll(/\\/gu, '/').replace(/^\.\//u, '').replaceAll(/\/{2,}/gu, '/');
}

/**
 * Declared sensitivity wins. Matching is exact against the normalized
 * declaration — the mechanism never infers meaning from a path string.
 */
export function declaredSensitivePaths(
  paths: readonly string[],
  declared: readonly string[] | undefined,
): readonly string[] {
  if (declared === undefined || declared.length === 0) return [];
  const wanted = new Set(declared.map((entry) => normalizeMergePath(entry)));
  return paths.filter((path) => wanted.has(normalizeMergePath(path)));
}

export function parseMergeRiskJudgment(text: string): MergeRiskJudgment | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const risky = record['risky'];
  const wideChange = record['wide_change'];
  if (typeof risky !== 'boolean') return undefined;
  if (typeof wideChange !== 'boolean') return undefined;
  const confidence = clampConfidence(record['confidence']);
  if (confidence === undefined) return undefined;
  const rawPaths = record['sensitive_paths'];
  const sensitivePaths = Array.isArray(rawPaths)
    ? rawPaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const rationaleRaw = record['rationale'];
  const rationale =
    typeof rationaleRaw === 'string' && rationaleRaw.trim().length > 0
      ? rationaleRaw.trim()
      : 'risk judgment';
  return { risky, sensitivePaths, wideChange, confidence, rationale };
}

/** A judgment below the confidence floor is not a judgment — record it undecidable. */
export function assessmentFromJudgment(judgment: MergeRiskJudgment): MergeRiskAssessment {
  return judgment.confidence < MERGE_RISK_CONFIDENCE_FLOOR ? 'undecidable' : judgment;
}

const riskCache = new Map<string, MergeRiskAssessment>();
const RISK_CACHE_MAX = 64;

/** Resolve the risk assessment: declaration first, else LLM, else undecidable. */
export async function resolveMergeRiskAssessment(input: {
  readonly judge: MergeRiskJudgeInput;
  readonly declaredDangerousPaths?: readonly string[];
  readonly deps: LlmClassifierDeps | undefined;
  readonly title?: string;
  readonly jobKind?: string;
  readonly signal?: AbortSignal;
}): Promise<MergeRiskAssessment> {
  const paths = input.judge.paths ?? [];
  // Declaration wins — the LLM only intervenes when nothing is declared.
  if (input.declaredDangerousPaths !== undefined && input.declaredDangerousPaths.length > 0) {
    const sensitive = declaredSensitivePaths(paths, input.declaredDangerousPaths);
    return {
      risky: sensitive.length > 0,
      sensitivePaths: sensitive,
      wideChange: false,
      confidence: 1,
      rationale: 'declared dangerous path list (project/operator declaration)',
    };
  }
  if (paths.length === 0 && input.judge.diffLines === undefined) {
    return { risky: false, sensitivePaths: [], wideChange: false, confidence: 1, rationale: 'no change reported' };
  }
  if (input.deps === undefined) return 'undecidable';
  return inferMergeRisk(input.deps, input.judge, { signal: input.signal });
}

export async function inferMergeRisk(
  deps: LlmClassifierDeps,
  input: MergeRiskJudgeInput,
  options?: { readonly signal?: AbortSignal },
): Promise<MergeRiskAssessment> {
  const cacheKey = riskCacheKey(input);
  const cached = riskCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const user = buildRiskJudgeUserPrompt(input);
  if (user === undefined) return 'undecidable';

  try {
    const response = await deps.generate(
      deps.provider,
      RISK_JUDGE_SYSTEM,
      [],
      [createUserMessage(user)],
      undefined,
      { signal: createClassifierTimeoutSignal(10_000, options?.signal) },
    );
    const parsed = parseMergeRiskJudgment(extractTextFromGenerateResponse(response));
    // Judgment failure is recorded as undecidable — never laundered into a pass.
    const assessment: MergeRiskAssessment =
      parsed === undefined ? 'undecidable' : assessmentFromJudgment(parsed);
    rememberRisk(cacheKey, assessment);
    return assessment;
  } catch {
    return 'undecidable';
  }
}

export function clearMergeRiskCache(): void {
  riskCache.clear();
}

function riskCacheKey(input: MergeRiskJudgeInput): string {
  return [
    input.jobKind ?? '',
    String(input.diffLines ?? ''),
    input.summary?.trim() ?? '',
    input.title?.trim() ?? '',
    (input.paths ?? []).join('\0'),
  ].join('\n');
}

function rememberRisk(key: string, value: MergeRiskAssessment): void {
  if (riskCache.size >= RISK_CACHE_MAX) {
    const first = riskCache.keys().next().value;
    if (first !== undefined) riskCache.delete(first);
  }
  riskCache.set(key, value);
}

function buildRiskJudgeUserPrompt(input: MergeRiskJudgeInput): string | undefined {
  const paths = input.paths ?? [];
  const summary = input.summary?.trim() ?? '';
  const title = input.title?.trim() ?? '';
  if (paths.length === 0 && input.diffLines === undefined && summary.length === 0 && title.length === 0) {
    return undefined;
  }
  const lines = ['Judge this change effect from the facts below.', ''];
  if (input.jobKind !== undefined && input.jobKind.length > 0) lines.push(`kind: ${input.jobKind}`);
  if (input.diffLines !== undefined) {
    lines.push(`reported_diff_lines: ${String(input.diffLines)} (self-reported by the caller)`);
  }
  if (paths.length > 0) {
    lines.push(`paths (copy exact strings for sensitive_paths):`);
    for (const path of paths.slice(0, 60)) lines.push(`- ${path}`);
  }
  if (summary.length > 0) lines.push(`diff_summary: ${clipClassifierText(summary, 1_200)}`);
  if (title.length > 0) lines.push(`title: ${clipClassifierText(title, 400)}`);
  return lines.join('\n');
}
