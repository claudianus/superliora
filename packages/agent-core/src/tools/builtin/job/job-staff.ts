/**
 * Conductor expert staffing: decompose an objective into ownership-safe slices,
 * SearchExpert each slice, bind high-score experts (else generic fallback).
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
  readonly contextPaths?: readonly string[];
  readonly ownershipPaths?: readonly string[];
  readonly maxSlices?: number;
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
  const slices = decomposeObjective(objective, input.title, input.ownershipPaths, maxSlices);

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
      ownershipPaths: slice.ownershipPaths ?? input.contextPaths,
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

function decomposeObjective(
  objective: string,
  title: string | undefined,
  ownershipPaths: readonly string[] | undefined,
  maxSlices: number,
): Array<{ title: string; prompt: string; ownershipPaths?: readonly string[] }> {
  // Ownership-partitioned fanout when caller already split paths.
  if (ownershipPaths !== undefined && ownershipPaths.length > 1) {
    const paths = ownershipPaths.slice(0, maxSlices);
    return paths.map((path) => ({
      title: `${title ?? 'Task'}: ${path}`,
      prompt: `${objective}\n\nFocus ownership path: ${path}`,
      ownershipPaths: [path],
    }));
  }

  // Lightweight intent split on numbered / bullet lines; else single slice.
  const lines = objective
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const bullets = lines.filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line));
  if (bullets.length >= 2) {
    return bullets.slice(0, maxSlices).map((line, index) => {
      const cleaned = line.replace(/^(?:[-*]|\d+[.)])\s+/, '');
      return {
        title: `${title ?? 'Task'} (${String(index + 1)})`,
        prompt: cleaned,
        ownershipPaths,
      };
    });
  }

  return [
    {
      title: title?.trim() || truncateTitle(objective),
      prompt: objective,
      ownershipPaths,
    },
  ];
}

function truncateTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 72 ? oneLine : `${oneLine.slice(0, 69)}…`;
}
