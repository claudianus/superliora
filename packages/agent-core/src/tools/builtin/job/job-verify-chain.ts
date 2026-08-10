/**
 * Implement → verify → (optional) debug Job chain.
 * Maker≠Checker: verify expertId must differ from the implement parent's.
 * Posture is JobKind (`verify` / `implement`), not an UltraSwarm expertRole.
 */

import type { Agent } from '../../../agent/index';
import { globalExpertSearchEngine } from '../../../expert-agents/search';
import { jobLooksLikeUiSurface } from '../../../premium-quality/ui-surface';
import { requestJobSchedulePump } from '../../../session/job/job-offload';
import type { ToolStore } from '../../store';
import { createJob, getJob, listJobs, patchJob, type JobRecord } from './job-ledger';
import { STAFF_MIN_EXPERT_SCORE } from './job-staff';

export type JobVerifyVerdict = 'passed' | 'failed' | 'not_run' | 'not_applicable';

/** Implement/task workers that should receive an automatic verify child. */
export function shouldEnqueueVerifyAfterDone(job: JobRecord): boolean {
  if (job.status !== 'done') return false;
  if (
    job.kind === 'merge' ||
    job.kind === 'push' ||
    job.kind === 'desk' ||
    job.kind === 'goal-desk' ||
    job.kind === 'explore' ||
    job.kind === 'research' ||
    job.kind === 'mission' ||
    job.kind === 'verify'
  ) {
    return false;
  }
  // Debug fixer children must not re-trigger another verify fan-out.
  if (job.kind === 'implement' && job.title.startsWith('Debug:') && job.parentJobId !== undefined) {
    return false;
  }
  return job.kind === 'task' || job.kind === 'implement';
}

export function hasVerifyChild(store: ToolStore, parentJobId: string): boolean {
  return findVerifyChild(parentJobId, listJobs(store)) !== undefined;
}

export function findVerifyChild(
  parentJobId: string,
  jobs: readonly JobRecord[],
): JobRecord | undefined {
  return jobs.find((job) => job.parentJobId === parentJobId && job.kind === 'verify');
}

export function findDebugChild(
  parentJobId: string,
  jobs: readonly JobRecord[],
): JobRecord | undefined {
  return jobs.find(
    (job) =>
      job.parentJobId === parentJobId &&
      job.kind === 'implement' &&
      job.title.startsWith('Debug:'),
  );
}

/**
 * Parse structured verify verdict from worker summary.
 * Accepts a JSON object anywhere in the text, or a leading `verdict: pass|fail` line.
 */
export function parseVerifyVerdict(summary: string | undefined): JobVerifyVerdict | undefined {
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

function normalizeVerdict(raw: string | undefined): JobVerifyVerdict | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'pass' || v === 'passed') return 'passed';
  if (v === 'fail' || v === 'failed') return 'failed';
  return undefined;
}

export function makerCheckerCollision(
  implementExpertId: string | undefined,
  verifyExpertId: string | undefined,
): boolean {
  const a = implementExpertId?.trim();
  const b = verifyExpertId?.trim();
  if (a === undefined || a.length === 0 || b === undefined || b.length === 0) return false;
  return a === b;
}

/** Staff + create a verify child for a completed implement job. */
export async function enqueueVerifyJobForParent(
  store: ToolStore,
  parent: JobRecord,
  agent?: Agent,
): Promise<JobRecord | undefined> {
  if (hasVerifyChild(store, parent.id)) return undefined;
  if (!shouldEnqueueVerifyAfterDone({ ...parent, status: 'done' })) return undefined;

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
    'You are an independent verify checker (Maker≠Checker). Do not implement product features.',
    `Parent job: ${parent.id} — ${parent.title}`,
    parent.resultSummary !== undefined ? `Parent summary:\n${parent.resultSummary.slice(0, 2500)}` : undefined,
    files !== undefined && files.length > 0 ? `Changed paths: ${files.join(', ')}` : undefined,
    parent.verificationCommands !== undefined && parent.verificationCommands.length > 0
      ? `Run these verification commands and cite exit codes:\n${parent.verificationCommands.map((c) => `- ${c}`).join('\n')}`
      : undefined,
    ui
      ? 'Re-run VerifySurface on the real surface when a URL/HTML path is available; inspect load+interaction+craft axes.'
      : 'Review the diff for correctness, regressions, and missing tests; run focused checks when available.',
    'Final output MUST include a JSON object: {"verdict":"pass"|"fail","findings":[...],"required_fixes":[...]}',
  ]
    .filter(Boolean)
    .join('\n\n');

  const verify = createJob(store, {
    title: `Verify: ${parent.title}`.slice(0, 120),
    kind: 'verify',
    priority: (parent.priority ?? 0) + 1,
    prompt,
    // Verify is Maker≠Checker read/audit — do not pre-claim exclusive write
    // leases on parent paths (blocks sibling Jobs at fan-out).
    contextPaths: parent.contextPaths ?? files,
    parentJobId: parent.id,
    expertId: pick?.expert.id,
    expertScore: pick?.score,
    staffQuery: query,
    successCriteria: [
      'Emit JSON verdict pass|fail with findings',
      ui ? 'VerifySurface axes considered' : 'Diff reviewed against success criteria',
    ],
    verificationCommands: parent.verificationCommands,
  });

  patchJob(store, parent.id, {
    notes: [parent.notes, `verify_chain: enqueued ${verify.id}`].filter(Boolean).join('\n'),
  });
  if (agent !== undefined) {
    requestJobSchedulePump({ store, agent });
  }
  return verify;
}

/** After a failing verify, enqueue a debug fixer (different expert when possible). */
export async function enqueueDebugJobForVerify(
  store: ToolStore,
  parent: JobRecord,
  verify: JobRecord,
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
    [parent.expertId, verify.expertId].filter((id): id is string => id !== undefined && id.length > 0),
  );
  const pick = hits.find(
    (hit) => hit.score >= STAFF_MIN_EXPERT_SCORE && !blocked.has(hit.expert.id),
  );

  const debug = createJob(store, {
    title: `Debug: ${parent.title}`.slice(0, 120),
    kind: 'implement',
    priority: (parent.priority ?? 0) + 2,
    prompt: [
      'You are a debug fixer. Reproduce verify findings with the smallest fix. Do not expand scope.',
      `Parent job: ${parent.id}`,
      `Verify job: ${verify.id}`,
      verify.resultSummary !== undefined
        ? `Verify findings:\n${verify.resultSummary.slice(0, 3000)}`
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
    staffQuery: query,
    successCriteria: ['Address verify required_fixes', 'Re-verify with checks or VerifySurface'],
  });

  patchJob(store, parent.id, {
    notes: [getJob(store, parent.id)?.notes, `verify_chain: debug enqueued ${debug.id}`]
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
 * - implement done → enqueue verify
 * - verify done → parse verdict; on fail enqueue debug; stamp parent notes
 */
export async function onJobTerminalForVerifyChain(
  store: ToolStore,
  job: JobRecord,
  agent?: Agent,
): Promise<void> {
  if (
    job.kind === 'verify' &&
    (job.status === 'done' || job.status === 'failed') &&
    job.parentJobId !== undefined
  ) {
    const parent = getJob(store, job.parentJobId);
    if (parent === undefined) return;
    const verdict =
      parseVerifyVerdict(job.resultSummary) ??
      (job.status === 'failed' ? 'failed' : undefined) ??
      'failed';
    patchJob(store, parent.id, {
      notes: [
        parent.notes,
        `verify_chain: ${job.id} verdict=${verdict}`,
        makerCheckerCollision(parent.expertId, job.expertId)
          ? 'verify_chain: MAKER_CHECKER_COLLISION same expertId on implement+verify'
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (verdict === 'failed') {
      await enqueueDebugJobForVerify(store, parent, job, agent);
    }
    return;
  }

  if (job.status === 'done' && shouldEnqueueVerifyAfterDone(job)) {
    if (hasVerifyChild(store, job.id)) return;
    await enqueueVerifyJobForParent(store, job, agent);
  }
}

/** Merge gate: UI/implement land needs a passed verify child (and no maker=checker). */
export function evaluateVerifyChainForMerge(input: {
  readonly job: JobRecord;
  readonly jobs: readonly JobRecord[];
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (
    input.job.kind === 'merge' ||
    input.job.kind === 'push' ||
    input.job.kind === 'desk' ||
    input.job.kind === 'explore' ||
    input.job.kind === 'research' ||
    input.job.kind === 'verify'
  ) {
    return { ok: true };
  }
  // Only gate coding deliveries.
  if (input.job.kind !== 'task' && input.job.kind !== 'implement') {
    return { ok: true };
  }

  const verify = findVerifyChild(input.job.id, input.jobs);
  if (verify === undefined) {
    return {
      ok: false,
      reason:
        'No verify child Job yet — wait for the automatic verify chain (Maker≠Checker) before MergeJob.',
    };
  }
  if (makerCheckerCollision(input.job.expertId, verify.expertId)) {
    return {
      ok: false,
      reason: `Maker≠Checker hard reject: implement and verify share expertId=${input.job.expertId ?? ''}.`,
    };
  }
  if (verify.status !== 'done' && verify.status !== 'failed') {
    return {
      ok: false,
      reason: `Verify job ${verify.id} is still ${verify.status} — wait for verdict before merge.`,
    };
  }
  const verdict = parseVerifyVerdict(verify.resultSummary);
  if (verdict !== 'passed') {
    return {
      ok: false,
      reason: `Verify job ${verify.id} verdict=${verdict ?? 'missing'} — fix via debug/implement requeue before merge.`,
    };
  }
  return { ok: true };
}
