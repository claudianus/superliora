/**
 * Conductor expert staffing: optionally intent-split an objective, then
 * SearchExpert each slice and bind high-score experts (else generic fallback).
 *
 * `ownership_paths` is a claim set for one Job — never a fan-out signal.
 * Splitting one coherent brief into N near-copies (one path each) races the
 * parent lease and burns tokens/worktrees.
 *
 * Intent fan-out is OFF by default. Bullet/numbered lists inside a single
 * JobCreate brief (success_criteria, verification steps, must_not_touch) are
 * not independent intents — only split when the caller opts in via
 * `allowIntentSplit` (JobCreate `auto_split=true`).
 */

import { globalExpertSearchEngine } from '../../../expert-agents/search';
import type { JobKind } from './job-store-key';

export type JobExpertRole = 'implement' | 'review' | 'debug' | 'visual-qa' | 'generic';

export interface StaffedJobSlice {
  readonly title: string;
  readonly prompt: string;
  readonly kind: JobKind;
  readonly ownershipPaths?: readonly string[];
  readonly expertId?: string;
  readonly expertScore?: number;
  readonly expertRole: JobExpertRole;
  readonly staffQuery: string;
}

export interface StaffJobsInput {
  readonly objective: string;
  readonly title?: string;
  readonly kind?: JobKind;
  readonly successCriteria?: readonly string[];
  readonly ownershipPaths?: readonly string[];
  readonly maxSlices?: number;
  /**
   * When true, may fan out numbered/bullet lines into multiple staffed Jobs.
   * Default false — staffing binds an expert to one Job; multi-intent uses
   * JobCreate `auto_split` (or separate JobCreate calls).
   */
  readonly allowIntentSplit?: boolean;
  /** Minimum SearchExpert score to bind an expert (else generic). */
  readonly minScore?: number;
  readonly signal?: AbortSignal;
}

/** Default floor — below this, spawn a generic worker instead of a weak expert. */
export const STAFF_MIN_EXPERT_SCORE = 0.08;
export const STAFF_MAX_SLICES = 5;

/**
 * Split + staff. Uses SearchExpert hybrid retrieval; never fails closed on
 * low scores — falls back to generic slices.
 */
export async function staffJobsFromObjective(
  input: StaffJobsInput,
): Promise<readonly StaffedJobSlice[]> {
  const objective = input.objective.trim();
  if (objective.length === 0) return [];

  const kind = input.kind ?? 'task';
  const maxSlices = Math.min(input.maxSlices ?? STAFF_MAX_SLICES, STAFF_MAX_SLICES);
  const minScore = input.minScore ?? STAFF_MIN_EXPERT_SCORE;
  const slices = decomposeObjective({
    objective,
    title: input.title,
    ownershipPaths: input.ownershipPaths,
    maxSlices,
    allowIntentSplit: input.allowIntentSplit === true,
  });

  await globalExpertSearchEngine.initialize();

  const staffed: StaffedJobSlice[] = [];
  for (const slice of slices) {
    if (input.signal?.aborted) break;
    const query = [slice.title, slice.prompt, ...(input.successCriteria ?? [])].join('\n');
    const hits = await globalExpertSearchEngine.search({
      query,
      topK: 3,
      taskDescription: query,
      signal: input.signal,
    });
    const best = hits[0];
    const bindExpert = best !== undefined && best.score >= minScore;
    staffed.push({
      title: slice.title,
      prompt: withCriteria(slice.prompt, input.successCriteria),
      kind,
      // Never promote context_paths into ownership — context is read-first hint only.
      ownershipPaths: slice.ownershipPaths ?? input.ownershipPaths,
      expertId: bindExpert ? best.expert.id : undefined,
      expertScore: best?.score,
      expertRole: bindExpert ? 'implement' : 'generic',
      staffQuery: query.slice(0, 500),
    });
  }
  return staffed;
}

function withCriteria(prompt: string, criteria: readonly string[] | undefined): string {
  if (criteria === undefined || criteria.length === 0) return prompt;
  return `${prompt}\n\nSuccess criteria:\n${criteria.map((c) => `- ${c}`).join('\n')}`;
}

function decomposeObjective(input: {
  objective: string;
  title: string | undefined;
  ownershipPaths: readonly string[] | undefined;
  maxSlices: number;
  allowIntentSplit: boolean;
}): Array<{ title: string; prompt: string; ownershipPaths?: readonly string[] }> {
  const { objective, title, ownershipPaths, maxSlices, allowIntentSplit } = input;

  // Claimed work stays one Job. Multi-path ownership means "touches these",
  // not "spawn one worker per path". Parallel packages need separate JobCreates
  // with disjoint ownership — auto-fanout here duplicate-runs the same brief.
  if (ownershipPaths !== undefined && ownershipPaths.length > 0) {
    return [
      {
        title: title?.trim() || truncateTitle(objective),
        prompt: objective,
        ownershipPaths,
      },
    ];
  }

  // Staffing alone never fans out. Bullet lists inside a single brief are
  // usually success_criteria / steps, not independent multi-intents.
  if (!allowIntentSplit) {
    return [
      {
        title: title?.trim() || truncateTitle(objective),
        prompt: objective,
        ownershipPaths,
      },
    ];
  }

  // Opt-in intent split on numbered / bullet lines; else single slice.
  const lines = objective
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const bullets = lines.filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line));
  if (bullets.length >= 2) {
    const cleaned = bullets
      .slice(0, maxSlices)
      .map((line) => line.replace(/^(?:[-*]|\d+[.)])\s+/, ''));
    // Near-identical prompts mean one brief restated N times — collapse.
    if (areNearIdenticalPrompts(cleaned)) {
      return [
        {
          title: title?.trim() || truncateTitle(objective),
          prompt: objective,
          ownershipPaths,
        },
      ];
    }
    return cleaned.map((item, index) => ({
      title: `${title ?? 'Task'} (${String(index + 1)})`,
      prompt: item,
    }));
  }

  return [
    {
      title: title?.trim() || truncateTitle(objective),
      prompt: objective,
      ownershipPaths,
    },
  ];
}

/** Collapse when split items are essentially the same task restated. */
function areNearIdenticalPrompts(items: readonly string[]): boolean {
  if (items.length < 2) return false;
  const norms = items.map(normalizePromptForCompare).filter((s) => s.length > 0);
  if (norms.length < 2) return false;
  const first = norms[0]!;
  let similar = 0;
  for (const other of norms.slice(1)) {
    if (first === other) {
      similar += 1;
      continue;
    }
    // High shared-token ratio → same intent with minor wording drift.
    const a = new Set(first.split(' '));
    const b = new Set(other.split(' '));
    let shared = 0;
    for (const token of a) {
      if (b.has(token)) shared += 1;
    }
    const union = a.size + b.size - shared;
    if (union > 0 && shared / union >= 0.72) similar += 1;
  }
  return similar >= norms.length - 1;
}

function normalizePromptForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s./_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 72 ? oneLine : `${oneLine.slice(0, 69)}…`;
}
