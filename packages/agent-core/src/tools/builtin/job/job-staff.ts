/**
 * Conductor expert staffing: bind SearchExpert (or generic fallback) to ONE Job.
 *
 * Staffing never fans out. Multi-intent work uses JobCreate `auto_split` (via
 * `splitUserMessageIntoJobIntents`) or separate JobCreate calls. Bullet/numbered
 * lines inside a single brief (success_criteria, steps, must_not_touch) stay on
 * that one Job.
 *
 * `ownership_paths` is a claim set for one Job — never a fan-out signal.
 * Worker posture is `JobKind` (implement / verify / research / …), not a role.
 */

import { globalExpertSearchEngine } from '../../../expert-agents/search';
import type { JobKind } from './job-store-key';

export interface StaffedJobSlice {
  readonly title: string;
  readonly prompt: string;
  readonly kind: JobKind;
  readonly ownershipPaths?: readonly string[];
  readonly expertId?: string;
  readonly expertScore?: number;
  readonly staffQuery: string;
}

export interface StaffJobsInput {
  readonly objective: string;
  readonly title?: string;
  readonly kind?: JobKind;
  readonly successCriteria?: readonly string[];
  readonly ownershipPaths?: readonly string[];
  /** Minimum SearchExpert score to bind an expert (else generic). */
  readonly minScore?: number;
  readonly signal?: AbortSignal;
}

/** Default floor — below this, spawn a generic worker instead of a weak expert. */
export const STAFF_MIN_EXPERT_SCORE = 0.08;

/**
 * Coding Job kinds staff only from technical divisions. Without this gate,
 * sparse fuzzy ranking can surface non-coding personas (marketing, meeting
 * notes, …) as the top expert for an implement brief.
 */
const CODING_STAFF_PREFERRED_DIVISIONS = [
  'engineering',
  'testing',
  'security',
  'product',
  'design',
] as const;

const CODING_STAFF_EXCLUDED_DIVISIONS = [
  'sales',
  'marketing',
  'paid-media',
  'finance',
  'support',
  'project-management',
  'legal',
  'academic',
] as const;

/** Cap for the text fed to lexical expert search after noise removal. */
const STAFF_QUERY_MAX_CHARS = 1200;

/**
 * Strip harness scaffolding from the search text. JobCreate prompts echo the
 * user message, which in Conductor sessions carries `<system-reminder>`
 * blocks (current time, tool workflow reminders, job desk) — none of it is
 * signal for expert selection, and its generic filler tokens measurably
 * distort sparse ranking (a meeting-notes persona topping a coding brief).
 */
export function cleanStaffQueryText(raw: string): string {
  let text = raw;
  // Remove whole reminder blocks (they nest markup like <current_time>).
  for (const tag of ['system-reminder', 'current_time', 'conductor_job_desk']) {
    text = text.replaceAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), ' ');
  }
  // Leftover tags plus clock boilerplate that is not brief content.
  text = text
    .replaceAll(/<[^>]{1,200}>/g, ' ')
    .replaceAll(/Authoritative host clock[\s\S]*?stale\./g, ' ')
    .replaceAll(/User asked:\s*/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return text.slice(0, STAFF_QUERY_MAX_CHARS);
}

/**
 * Staff a single objective. Uses SearchExpert hybrid retrieval; never fails
 * closed on low scores — falls back to a generic slice. Always returns 0 or 1
 * slice (empty objective → []).
 */
export async function staffJobsFromObjective(
  input: StaffJobsInput,
): Promise<readonly StaffedJobSlice[]> {
  const objective = input.objective.trim();
  if (objective.length === 0) return [];

  const kind = input.kind ?? 'task';
  const minScore = input.minScore ?? STAFF_MIN_EXPERT_SCORE;
  const title = input.title?.trim() || truncateTitle(objective);

  if (input.signal?.aborted) return [];

  await globalExpertSearchEngine.initialize();

  const query = cleanStaffQueryText(
    [title, objective, ...(input.successCriteria ?? [])].join('\n'),
  );
  const isCodingStaff =
    kind === 'task' || kind === 'implement' || kind === 'verify';
  const hits = await globalExpertSearchEngine.search({
    query,
    topK: 3,
    taskDescription: query,
    signal: input.signal,
    // Coding kinds must not staff a sales/marketing/notes persona; keep the
    // sparse fallback inside technical divisions for implement/task/verify.
    ...(isCodingStaff
      ? {
          preferredDivisions: [...CODING_STAFF_PREFERRED_DIVISIONS],
          excludedDivisions: [...CODING_STAFF_EXCLUDED_DIVISIONS],
        }
      : {}),
  });
  const best = hits[0];
  const bindExpert = best !== undefined && best.score >= minScore;

  return [
    {
      title,
      prompt: withCriteria(objective, input.successCriteria),
      kind,
      // Never promote context_paths into ownership — context is read-first hint only.
      ownershipPaths: input.ownershipPaths,
      expertId: bindExpert ? best.expert.id : undefined,
      expertScore: best?.score,
      staffQuery: query.slice(0, 500),
    },
  ];
}

function withCriteria(prompt: string, criteria: readonly string[] | undefined): string {
  if (criteria === undefined || criteria.length === 0) return prompt;
  return `${prompt}\n\nSuccess criteria:\n${criteria.map((c) => `- ${c}`).join('\n')}`;
}

function truncateTitle(text: string): string {
  const oneLine = text.replaceAll(/\s+/g, ' ').trim();
  return oneLine.length <= 72 ? oneLine : `${oneLine.slice(0, 69)}…`;
}
