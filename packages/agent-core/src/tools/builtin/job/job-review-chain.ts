/**
 * Implement → review → (optional) debug Job chain.
 * Maker≠Checker: review expertId must differ from the implement parent's.
 */

import type { Agent } from '../../../agent/index';
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
  if (
    job.kind === 'merge' ||
    job.kind === 'push' ||
    job.kind === 'desk' ||
    job.kind === 'goal-desk'
  ) {
    return false;
  }
  if (job.kind === 'explore' || job.kind === 'mission') return false;
  const role = job.expertRole ?? 'implement';
  if (REVIEW_ROLES.has(role)) return false;
  return job.kind === 'task' || job.kind === 'implement';
}

export function findReviewChildren(
  parentJobId: string,
  jobs: readonly JobRecord[],
): readonly JobRecord[] {
  return jobs.filter(
    (job) =>
      job.parentJobId === parentJobId &&
      (job.expertRole === 'review' || job.expertRole === 'visual-qa'),
  );
}

/** True when the required review set for this parent is already enqueued. */
export function hasReviewChild(store: ToolStore, parentJobId: string): boolean {
  const children = findReviewChildren(parentJobId, listJobs(store));
  if (children.length === 0) return false;
  // Parallel dual-axis: both standards + spec present.
  const axes = new Set(children.map((c) => c.reviewAxis).filter(Boolean));
  if (axes.has('standards') && axes.has('spec')) return true;
  // Legacy / visual-qa: any single review child counts.
  return children.some((c) => c.reviewAxis === undefined);
}

/** First review child (compat); prefer findReviewChildren for dual-axis. */
export function findReviewChild(
  parentJobId: string,
  jobs: readonly JobRecord[],
): JobRecord | undefined {
  return findReviewChildren(parentJobId, jobs)[0];
}

export function findDebugChild(
  parentJobId: string,
  jobs: readonly JobRecord[],
): JobRecord | undefined {
  return jobs.find((job) => job.parentJobId === parentJobId && job.expertRole === 'debug');
}

type AxisVerdictBlob = { readonly verdict?: string };

/**
 * Parse structured review verdict from worker summary.
 * Prefer dual-axis JSON (standards + spec); overall pass only when both axes pass.
 * Falls back to a single top-level verdict or a `verdict: pass|fail` line.
 */
export function parseReviewVerdict(summary: string | undefined): JobReviewVerdict | undefined {
  if (summary === undefined || summary.trim().length === 0) return undefined;
  const text = summary.trim();
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        verdict?: string;
        standards?: AxisVerdictBlob;
        spec?: AxisVerdictBlob;
      };
      const standards = normalizeVerdict(parsed.standards?.verdict);
      const spec = normalizeVerdict(parsed.spec?.verdict);
      if (standards !== undefined && spec !== undefined) {
        if (standards === 'passed' && spec === 'passed') return 'passed';
        return 'failed';
      }
      // Parallel axis Jobs emit only their axis blob.
      if (standards !== undefined && spec === undefined) return standards;
      if (spec !== undefined && standards === undefined) return spec;
      const top = normalizeVerdict(parsed.verdict);
      if (top !== undefined) return top;
    }
  } catch {
    // fall through
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

async function pickReviewExpert(
  query: string,
  parentExpert: string | undefined,
  blockedExpertIds: ReadonlySet<string> = new Set(),
): Promise<{ readonly id?: string; readonly score?: number }> {
  await globalExpertSearchEngine.initialize();
  const hits = await globalExpertSearchEngine.search({
    query,
    topK: 8,
    taskDescription: query,
  });
  const pick = hits.find(
    (hit) =>
      hit.score >= STAFF_MIN_EXPERT_SCORE &&
      (parentExpert === undefined || hit.expert.id !== parentExpert) &&
      !blockedExpertIds.has(hit.expert.id),
  );
  return { id: pick?.expert.id, score: pick?.score };
}

function sharedReviewContext(parent: JobRecord): {
  readonly files: readonly string[] | undefined;
  readonly header: string;
} {
  const files = parent.resultContract?.files_changed?.slice(0, 20) ?? parent.ownershipPaths;
  const header = [
    'You are an independent review checker (Maker≠Checker). Do not implement product features.',
    `Parent job: ${parent.id} — ${parent.title}`,
    parent.resultSummary !== undefined
      ? `Parent summary:\n${parent.resultSummary.slice(0, 2500)}`
      : undefined,
    parent.successCriteria !== undefined && parent.successCriteria.length > 0
      ? `Spec / success criteria:\n${parent.successCriteria.map((c) => `- ${c}`).join('\n')}`
      : undefined,
    parent.testSeams !== undefined && parent.testSeams.length > 0
      ? `Agreed test seams:\n${parent.testSeams.map((s) => `- ${s}`).join('\n')}`
      : undefined,
    files !== undefined && files.length > 0 ? `Changed paths: ${files.join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { files, header };
}

/** Staff + create review child(ren) for a completed implement job. */
export async function enqueueReviewJobForParent(
  store: ToolStore,
  parent: JobRecord,
  agent?: Agent,
): Promise<JobRecord | undefined> {
  if (hasReviewChild(store, parent.id)) return undefined;
  if (!shouldEnqueueReviewAfterDone({ ...parent, status: 'done' })) return undefined;

  const ui = jobLooksLikeUiSurface(parent);
  const { files, header } = sharedReviewContext(parent);
  const parentExpert = parent.expertId?.trim();
  const created: JobRecord[] = [];

  if (ui) {
    const query = 'visual QA UI craft review accessibility interaction screenshot';
    const pick = await pickReviewExpert(query, parentExpert);
    const prompt = [
      header,
      'Review on TWO axes without mixing them (single Job, dual-axis JSON):',
      '- Standards: craft / accessibility / banned-ship smells; repo docs override.',
      '- Spec: success criteria + VerifySurface load+interaction+craft when a URL/HTML path exists.',
      'Final output MUST include dual-axis JSON: {"verdict":"pass"|"fail","standards":{"verdict":"pass"|"fail","findings":[]},"spec":{"verdict":"pass"|"fail","findings":[]},"findings":[],"required_fixes":[]}. Overall pass only when both axes pass.',
    ].join('\n\n');
    created.push(
      createJob(store, {
        title: `Review: ${parent.title}`.slice(0, 120),
        kind: 'task',
        priority: (parent.priority ?? 0) + 1,
        prompt,
        contextPaths: parent.contextPaths ?? files,
        parentJobId: parent.id,
        expertId: pick.id,
        expertScore: pick.score,
        expertRole: 'visual-qa',
        staffQuery: query,
        successCriteria: [
          'Emit dual-axis JSON (standards + spec) with overall verdict',
          'VerifySurface axes considered',
        ],
      }),
    );
  } else {
    // Parallel Standards ∥ Spec so neither axis pollutes the other.
    const standardsPick = await pickReviewExpert(
      'code review standards smells conventions AGENTS.md',
      parentExpert,
    );
    const blocked = new Set(
      [standardsPick.id].filter((id): id is string => id !== undefined && id.length > 0),
    );
    const specPick = await pickReviewExpert(
      'code review correctness spec acceptance criteria regressions',
      parentExpert,
      blocked,
    );

    const standardsPrompt = [
      header,
      'AXIS: Standards only. Do not judge spec completeness here.',
      'Check repo AGENTS.md / coding standards; flag judgement-call smells (Mysterious Name, Duplicated Code, Feature Envy, Speculative Generality, Shotgun Surgery). Repo docs override smells; skip what tooling already enforces.',
      'Final output MUST include JSON: {"verdict":"pass"|"fail","standards":{"verdict":"pass"|"fail","findings":[]},"findings":[],"required_fixes":[]}',
    ].join('\n\n');
    const specPrompt = [
      header,
      'AXIS: Spec only. Do not re-litigate style/smell standards here.',
      'Did the diff faithfully implement the success criteria / seams? Note missing, wrong, or scope-creep behaviour. Check tests at agreed seams.',
      'Final output MUST include JSON: {"verdict":"pass"|"fail","spec":{"verdict":"pass"|"fail","findings":[]},"findings":[],"required_fixes":[]}',
    ].join('\n\n');

    created.push(
      createJob(store, {
        title: `Review standards: ${parent.title}`.slice(0, 120),
        kind: 'task',
        priority: (parent.priority ?? 0) + 1,
        prompt: standardsPrompt,
        contextPaths: parent.contextPaths ?? files,
        parentJobId: parent.id,
        expertId: standardsPick.id,
        expertScore: standardsPick.score,
        expertRole: 'review',
        reviewAxis: 'standards',
        staffQuery: 'code review standards smells conventions',
        successCriteria: ['Emit Standards-axis JSON verdict'],
      }),
      createJob(store, {
        title: `Review spec: ${parent.title}`.slice(0, 120),
        kind: 'task',
        priority: (parent.priority ?? 0) + 1,
        prompt: specPrompt,
        contextPaths: parent.contextPaths ?? files,
        parentJobId: parent.id,
        expertId: specPick.id ?? standardsPick.id,
        expertScore: specPick.score ?? standardsPick.score,
        expertRole: 'review',
        reviewAxis: 'spec',
        staffQuery: 'code review correctness spec acceptance',
        successCriteria: ['Emit Spec-axis JSON verdict'],
      }),
    );
  }

  const ids = created.map((j) => j.id).join(', ');
  patchJob(store, parent.id, {
    notes: [parent.notes, `review_chain: enqueued ${ids}`].filter(Boolean).join('\n'),
  });
  if (agent !== undefined) {
    requestJobSchedulePump({ store, agent });
  }
  return created[0];
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
      'You are a debug fixer. Establish a tight red-capable repro before hypothesising; then apply the smallest fix. Do not expand scope.',
      `Parent job: ${parent.id}`,
      `Review job: ${review.id}`,
      review.resultSummary !== undefined
        ? `Review findings:\n${review.resultSummary.slice(0, 3000)}`
        : undefined,
      parent.testSeams !== undefined && parent.testSeams.length > 0
        ? `Prefer regression tests at these seams: ${parent.testSeams.join('; ')}`
        : undefined,
      'After fixes, re-run focused checks / VerifySurface as applicable. Record repro_command + repro_output in the summary.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    ownershipPaths: parent.ownershipPaths,
    contextPaths: parent.contextPaths,
    testSeams: parent.testSeams,
    tddMode: parent.tddMode ?? 'preferred',
    parentJobId: parent.id,
    expertId: pick?.expert.id,
    expertScore: pick?.score,
    expertRole: 'debug',
    staffQuery: query,
    successCriteria: [
      'Tight repro goes red then green after the fix',
      'Address review required_fixes',
      'Re-verify with checks or VerifySurface',
    ],
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

function reviewChildrenReady(children: readonly JobRecord[]): boolean {
  if (children.length === 0) return false;
  return children.every((c) => c.status === 'done' || c.status === 'failed');
}

function aggregateReviewVerdict(children: readonly JobRecord[]): JobReviewVerdict {
  let anyFailed = false;
  for (const child of children) {
    const v =
      parseReviewVerdict(child.resultSummary) ??
      (child.status === 'failed' ? 'failed' : undefined) ??
      'failed';
    if (v !== 'passed') anyFailed = true;
  }
  return anyFailed ? 'failed' : 'passed';
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
    const children = findReviewChildren(parent.id, listJobs(store));
    const axisNote = `review_chain: ${job.id}${job.reviewAxis !== undefined ? ` axis=${job.reviewAxis}` : ''} verdict=${
      parseReviewVerdict(job.resultSummary) ?? (job.status === 'failed' ? 'failed' : 'missing')
    }`;
    patchJob(store, parent.id, {
      notes: [
        parent.notes,
        axisNote,
        makerCheckerCollision(parent.expertId, job.expertId)
          ? 'review_chain: MAKER_CHECKER_COLLISION same expertId on implement+review'
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (!reviewChildrenReady(children)) return;
    const verdict = aggregateReviewVerdict(children);
    const latestParent = getJob(store, parent.id) ?? parent;
    patchJob(store, parent.id, {
      notes: [latestParent.notes, `review_chain: aggregate verdict=${verdict}`]
        .filter(Boolean)
        .join('\n'),
    });
    if (verdict === 'failed') {
      const failedChild =
        children.find((c) => parseReviewVerdict(c.resultSummary) !== 'passed') ?? children[0]!;
      await enqueueDebugJobForReview(store, latestParent, failedChild, agent);
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
  if (
    input.job.kind === 'merge' ||
    input.job.kind === 'push' ||
    input.job.kind === 'desk' ||
    input.job.kind === 'explore'
  ) {
    return { ok: true };
  }
  // Only gate coding deliveries.
  if (input.job.kind !== 'task' && input.job.kind !== 'implement') {
    return { ok: true };
  }

  const children = findReviewChildren(input.job.id, input.jobs);
  if (children.length === 0) {
    return {
      ok: false,
      reason:
        'No review child Job yet — wait for the automatic review chain (Maker≠Checker) before MergeJob.',
    };
  }
  for (const review of children) {
    if (makerCheckerCollision(input.job.expertId, review.expertId)) {
      return {
        ok: false,
        reason: `Maker≠Checker hard reject: implement and review share expertId=${input.job.expertId ?? ''}.`,
      };
    }
  }
  if (!reviewChildrenReady(children)) {
    const pending = children.find((c) => c.status !== 'done' && c.status !== 'failed');
    return {
      ok: false,
      reason: `Review job ${pending?.id ?? children[0]!.id} is still ${pending?.status ?? 'pending'} — wait for verdict before merge.`,
    };
  }
  // Dual-axis: require both standards + spec when those axes were enqueued.
  const axes = new Set(children.map((c) => c.reviewAxis).filter(Boolean));
  if (axes.has('standards') !== axes.has('spec') && axes.size > 0) {
    return {
      ok: false,
      reason: 'Review chain incomplete — both Standards and Spec axis Jobs are required.',
    };
  }
  const verdict = aggregateReviewVerdict(children);
  if (verdict !== 'passed') {
    const failed = children.find((c) => parseReviewVerdict(c.resultSummary) !== 'passed');
    return {
      ok: false,
      reason: `Review job ${failed?.id ?? children[0]!.id} verdict=${
        parseReviewVerdict(failed?.resultSummary) ?? 'missing'
      } — fix via debug/implement requeue before merge.`,
    };
  }
  return { ok: true };
}
