/**
 * Implement → review → (optional) debug Job chain.
 * Maker≠Checker: review expertId must differ from the implement parent's.
 */

import type { Agent } from '../../../agent';
import { globalExpertSearchEngine } from '../../../expert-agents/search';
import { jobLooksLikeUiSurface } from '../../../premium-quality/ui-surface';
import { requestJobSchedulePump } from '../../../session/job/job-offload';
import type { ToolStore } from '../../store';
import { createJob, getJob, listJobs, patchJob, type JobRecord } from './job-ledger';
import { STAFF_MIN_EXPERT_SCORE } from './job-staff';

export type JobReviewVerdict = 'passed' | 'failed' | 'not_run' | 'not_applicable';

const REVIEW_ROLES = new Set(['review', 'debug', 'visual-qa']);

/** Implement/task workers that should receive an automatic review child. */
export function shouldEnqueueReviewAfterDone(job: JobRecord): boolean {
  if (job.status !== 'done') return false;
  if (job.kind === 'merge' || job.kind === 'desk' || job.kind === 'goal-desk') return false;
  if (job.kind === 'explore' || job.kind === 'mission') return false;
  const role = job.expertRole ?? 'implement';
  if (REVIEW_ROLES.has(role)) return false;
  return job.kind === 'task' || job.kind === 'implement';
}

export function hasReviewChild(store: ToolStore, parentJobId: string): boolean {
  return findReviewChild(parentJobId, listJobs(store)) !== undefined;
}

export function findReviewChild(
  parentJobId: string,
  jobs: readonly JobRecord[],
): JobRecord | undefined {
  return jobs.find(
    (job) =>
      job.parentJobId === parentJobId &&
      (job.expertRole === 'review' || job.expertRole === 'visual-qa'),
  );
}

export function findDebugChild(
  parentJobId: string,
  jobs: readonly JobRecord[],
): JobRecord | undefined {
  return jobs.find((job) => job.parentJobId === parentJobId && job.expertRole === 'debug');
}

/**
 * Parse structured review verdict from worker summary.
 * Accepts a JSON object anywhere in the text, or a leading `verdict: pass|fail` line.
 */
export function parseReviewVerdict(summary: string | undefined): JobReviewVerdict | undefined {
  if (summary === undefined || summary.trim().length === 0) return undefined;
  const text = summary.trim();
  const jsonMatch = text.match(/\{[\s\S]*"verdict"\s*:\s*"(pass|fail|passed|failed)"[\s\S]*\}/i);
  if (jsonMatch !== null) {
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(text.slice(start, end + 1)) as { verdict?: string };
        return normalizeVerdict(parsed.verdict);
      }
    } catch {
      // fall through
    }
  }
  const line = text.match(/\bverdict\s*[:=]\s*(pass|fail|passed|failed)\b/i);
  if (line?.[1] !== undefined) return normalizeVerdict(line[1]);
  return undefined;
}

function normalizeVerdict(raw: string | undefined): JobReviewVerdict | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'pass' || v === 'passed') return 'passed';
  if (v === 'fail' || v === 'failed') return 'failed';
  return undefined;
}

export function makerCheckerCollision(
  implementExpertId: string | undefined,
  reviewExpertId: string | undefined,
): boolean {
  const a = implementExpertId?.trim();
  const b = reviewExpertId?.trim();
  if (a === undefined || a.length === 0 || b === undefined || b.length === 0) return false;
  return a === b;
}

/** Staff + create a review child for a completed implement job. */
export async function enqueueReviewJobForParent(
  store: ToolStore,
  parent: JobRecord,
  agent?: Agent,
): Promise<JobRecord | undefined> {
  if (hasReviewChild(store, parent.id)) return undefined;
  if (!shouldEnqueueReviewAfterDone({ ...parent, status: 'done' })) return undefined;

  const ui = jobLooksLikeUiSurface(parent);
  const query = ui
    ? 'visual QA UI craft review accessibility interaction screenshot'
    : 'code review correctness security edge cases regression';
  await globalExpertSearchEngine.initialize();
  const hits = await globalExpertSearchEngine.search({
    query,
    topK: 8,
    taskDescription: query,
  });
  const parentExpert = parent.expertId?.trim();
  const pick = hits.find(
    (hit) =>
      hit.score >= STAFF_MIN_EXPERT_SCORE &&
      (parentExpert === undefined || hit.expert.id !== parentExpert),
  );

  const files = parent.resultContract?.files_changed?.slice(0, 20) ?? parent.ownershipPaths;
  const prompt = [
    'You are an independent review checker (Maker≠Checker). Do not implement product features.',
    `Parent job: ${parent.id} — ${parent.title}`,
    parent.resultSummary !== undefined ? `Parent summary:\n${parent.resultSummary.slice(0, 2500)}` : undefined,
    files !== undefined && files.length > 0 ? `Changed paths: ${files.join(', ')}` : undefined,
    ui
      ? 'Re-run VerifySurface on the real surface when a URL/HTML path is available; inspect load+interaction+craft axes.'
      : 'Review the diff for correctness, regressions, and missing tests.',
    'Final output MUST include a JSON object: {"verdict":"pass"|"fail","findings":[...],"required_fixes":[...]}',
  ]
    .filter(Boolean)
    .join('\n\n');

  const review = createJob(store, {
    title: `Review: ${parent.title}`.slice(0, 120),
    kind: 'task',
    priority: (parent.priority ?? 0) + 1,
    prompt,
    ownershipPaths: parent.ownershipPaths,
    contextPaths: parent.contextPaths ?? files,
    parentJobId: parent.id,
    expertId: pick?.expert.id,
    expertScore: pick?.score,
    expertRole: ui ? 'visual-qa' : 'review',
    staffQuery: query,
    successCriteria: [
      'Emit JSON verdict pass|fail with findings',
      ui ? 'VerifySurface axes considered' : 'Diff reviewed against success criteria',
    ],
  });

  patchJob(store, parent.id, {
    notes: [parent.notes, `review_chain: enqueued ${review.id}`].filter(Boolean).join('\n'),
  });
  if (agent !== undefined) {
    requestJobSchedulePump({ store, agent });
  }
  return review;
}

/** After a failing review, enqueue a debug fixer (different expert when possible). */
export async function enqueueDebugJobForReview(
  store: ToolStore,
  parent: JobRecord,
  review: JobRecord,
  agent?: Agent,
): Promise<JobRecord | undefined> {
  if (findDebugChild(parent.id, listJobs(store)) !== undefined) return undefined;

  const query = 'debug root cause fix failing tests interaction regression';
  await globalExpertSearchEngine.initialize();
  const hits = await globalExpertSearchEngine.search({
    query,
    topK: 8,
    taskDescription: query,
  });
  const blocked = new Set(
    [parent.expertId, review.expertId].filter((id): id is string => id !== undefined && id.length > 0),
  );
  const pick = hits.find(
    (hit) => hit.score >= STAFF_MIN_EXPERT_SCORE && !blocked.has(hit.expert.id),
  );

  const debug = createJob(store, {
    title: `Debug: ${parent.title}`.slice(0, 120),
    kind: 'implement',
    priority: (parent.priority ?? 0) + 2,
    prompt: [
      'You are a debug fixer. Reproduce review findings with the smallest fix. Do not expand scope.',
      `Parent job: ${parent.id}`,
      `Review job: ${review.id}`,
      review.resultSummary !== undefined
        ? `Review findings:\n${review.resultSummary.slice(0, 3000)}`
        : undefined,
      'After fixes, re-run focused checks / VerifySurface as applicable.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    ownershipPaths: parent.ownershipPaths,
    contextPaths: parent.contextPaths,
    parentJobId: parent.id,
    expertId: pick?.expert.id,
    expertScore: pick?.score,
    expertRole: 'debug',
    staffQuery: query,
    successCriteria: ['Address review required_fixes', 'Re-verify with checks or VerifySurface'],
  });

  patchJob(store, parent.id, {
    notes: [getJob(store, parent.id)?.notes, `review_chain: debug enqueued ${debug.id}`]
      .filter(Boolean)
      .join('\n'),
  });
  if (agent !== undefined) {
    requestJobSchedulePump({ store, agent });
  }
  return debug;
}

/**
 * Handle terminal completion for chain bookkeeping.
 * - implement done → enqueue review
 * - review done → parse verdict; on fail enqueue debug; stamp parent notes
 */
export async function onJobTerminalForReviewChain(
  store: ToolStore,
  job: JobRecord,
  agent?: Agent,
): Promise<void> {
  const role = job.expertRole ?? 'implement';

  if (
    (role === 'review' || role === 'visual-qa') &&
    (job.status === 'done' || job.status === 'failed') &&
    job.parentJobId !== undefined
  ) {
    const parent = getJob(store, job.parentJobId);
    if (parent === undefined) return;
    const verdict =
      parseReviewVerdict(job.resultSummary) ??
      (job.status === 'failed' ? 'failed' : undefined) ??
      'failed';
    patchJob(store, parent.id, {
      notes: [
        parent.notes,
        `review_chain: ${job.id} verdict=${verdict}`,
        makerCheckerCollision(parent.expertId, job.expertId)
          ? 'review_chain: MAKER_CHECKER_COLLISION same expertId on implement+review'
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (verdict === 'failed') {
      await enqueueDebugJobForReview(store, parent, job, agent);
    }
    return;
  }

  if (job.status === 'done' && shouldEnqueueReviewAfterDone(job)) {
    if (hasReviewChild(store, job.id)) return;
    await enqueueReviewJobForParent(store, job, agent);
  }
}

/** Merge gate: UI/implement land needs a passed review child (and no maker=checker). */
export function evaluateReviewChainForMerge(input: {
  readonly job: JobRecord;
  readonly jobs: readonly JobRecord[];
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const role = input.job.expertRole ?? 'implement';
  if (REVIEW_ROLES.has(role)) {
    return { ok: true }; // merging a review job itself is unusual; trust path handles elsewhere
  }
  if (input.job.kind === 'merge' || input.job.kind === 'desk' || input.job.kind === 'explore') {
    return { ok: true };
  }
  // Only gate coding deliveries.
  if (input.job.kind !== 'task' && input.job.kind !== 'implement') {
    return { ok: true };
  }

  const review = findReviewChild(input.job.id, input.jobs);
  if (review === undefined) {
    return {
      ok: false,
      reason:
        'No review child Job yet — wait for the automatic review chain (Maker≠Checker) before MergeJob.',
    };
  }
  if (makerCheckerCollision(input.job.expertId, review.expertId)) {
    return {
      ok: false,
      reason: `Maker≠Checker hard reject: implement and review share expertId=${input.job.expertId ?? ''}.`,
    };
  }
  if (review.status !== 'done' && review.status !== 'failed') {
    return {
      ok: false,
      reason: `Review job ${review.id} is still ${review.status} — wait for verdict before merge.`,
    };
  }
  const verdict = parseReviewVerdict(review.resultSummary);
  if (verdict !== 'passed') {
    return {
      ok: false,
      reason: `Review job ${review.id} verdict=${verdict ?? 'missing'} — fix via debug/implement requeue before merge.`,
    };
  }
  return { ok: true };
}
