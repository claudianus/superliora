/**
 * Implement → verify → (optional) debug Job chain.
 * Maker≠Checker: verify expertId must differ from the implement parent's.
 * Posture is JobKind (`verify` / `implement`), not an UltraSwarm expertRole.
 */

import type { Agent } from '../../../agent/index';
import { globalExpertSearchEngine } from '../../../expert-agents/search';
import { requestJobSchedulePump } from '../../../session/job/job-offload';
import type { ToolStore } from '../../store';
import { createJob, getJob, listJobs, patchJob, type JobRecord } from './job-ledger';
import { surfaceRequiresVisualProof } from './job-surface';
import { STAFF_MIN_EXPERT_SCORE } from './job-staff';

export type JobVerifyVerdict = 'passed' | 'failed' | 'not_run' | 'not_applicable';

/**
 * Structured verifyVerdict only — MergeJob trusts this, not free-text scrape.
 * Workers/onJobTerminal stamp verifyVerdict from parseVerifyVerdict at completion.
 */
export function resolveVerifyChildVerdict(job: JobRecord): JobVerifyVerdict | undefined {
  if (job.verifyVerdict === 'passed' || job.verifyVerdict === 'failed') {
    return job.verifyVerdict;
  }
  return undefined;
}

/** Stamp helper: structured field, else parse summary (completion path only). */
export function resolveVerifyChildVerdictForStamp(job: JobRecord): JobVerifyVerdict | undefined {
  if (job.verifyVerdict === 'passed' || job.verifyVerdict === 'failed') {
    return job.verifyVerdict;
  }
  return parseVerifyVerdict(job.resultSummary);
}

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

export function findVerifyChildren(
  parentJobId: string,
  jobs: readonly JobRecord[],
): readonly JobRecord[] {
  return jobs.filter((job) => job.parentJobId === parentJobId && job.kind === 'verify');
}

/** True when the required verify set for this parent is already enqueued. */
export function hasVerifyChild(store: ToolStore, parentJobId: string): boolean {
  const children = findVerifyChildren(parentJobId, listJobs(store));
  if (children.length === 0) return false;
  // Parallel dual-axis: both standards + spec present.
  const axes = new Set(children.map((c) => c.reviewAxis).filter(Boolean));
  if (axes.has('standards') && axes.has('spec')) return true;
  // Combined / UI verify: any single verify child counts.
  return children.some((c) => c.reviewAxis === undefined);
}

/** First verify child (compat); prefer findVerifyChildren for dual-axis. */
export function findVerifyChild(
  parentJobId: string,
  jobs: readonly JobRecord[],
): JobRecord | undefined {
  return findVerifyChildren(parentJobId, jobs)[0];
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

type AxisVerdictBlob = { readonly verdict?: string };

/**
 * Parse structured verify verdict from worker summary.
 * Prefer dual-axis JSON (standards + spec); overall pass only when both axes pass.
 * Falls back to a single top-level verdict or a `verdict: pass|fail` line.
 */
export function parseVerifyVerdict(summary: string | undefined): JobVerifyVerdict | undefined {
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

async function pickVerifyExpert(
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

function sharedVerifyContext(parent: JobRecord): {
  readonly files: readonly string[] | undefined;
  readonly header: string;
} {
  const files = parent.resultContract?.files_changed?.slice(0, 20) ?? parent.ownershipPaths;
  const header = [
    'You are an independent verify checker (Maker≠Checker). Do not implement product features.',
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
    parent.verificationCommands !== undefined && parent.verificationCommands.length > 0
      ? `Run these verification commands and cite exit codes:\n${parent.verificationCommands.map((c) => `- ${c}`).join('\n')}`
      : undefined,
    files !== undefined && files.length > 0 ? `Changed paths: ${files.join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { files, header };
}

/** Staff + create verify child(ren) for a completed implement job. */
export async function enqueueVerifyJobForParent(
  store: ToolStore,
  parent: JobRecord,
  agent?: Agent,
): Promise<JobRecord | undefined> {
  if (hasVerifyChild(store, parent.id)) return undefined;
  if (!shouldEnqueueVerifyAfterDone({ ...parent, status: 'done' })) return undefined;

  // Surface contract drives verify shape — never path/keyword regex.
  const visualSurface = surfaceRequiresVisualProof(parent.surfaceKind);
  const { files, header } = sharedVerifyContext(parent);
  const parentExpert = parent.expertId?.trim();
  const created: JobRecord[] = [];

  if (visualSurface) {
    const isTui = parent.surfaceKind === 'tui';
    const query = isTui
      ? 'TUI visual smoke craft review ANSI terminal'
      : 'visual QA UI craft review accessibility interaction screenshot';
    const pick = await pickVerifyExpert(query, parentExpert);
    const proofLine = isTui
      ? '- Spec: success criteria + TUI visual smoke (`pnpm -C apps/liora run smoke:visual` or recorded ANSI evidence). VerifySurface is N/A for ANSI/TUI.'
      : '- Spec: success criteria + VerifySurface load+interaction+craft when a URL/HTML path exists.';
    const criteria = isTui
      ? [
          'Emit dual-axis JSON (standards + spec) with overall verdict',
          'TUI visual smoke considered',
        ]
      : [
          'Emit dual-axis JSON (standards + spec) with overall verdict',
          'VerifySurface axes considered',
        ];
    const prompt = [
      header,
      'Verify on TWO axes without mixing them (single Job, dual-axis JSON):',
      '- Standards: craft / accessibility / banned-ship smells; repo docs override.',
      proofLine,
      'Final output MUST include dual-axis JSON: {"verdict":"pass"|"fail","standards":{"verdict":"pass"|"fail","findings":[]},"spec":{"verdict":"pass"|"fail","findings":[]},"findings":[],"required_fixes":[]}. Overall pass only when both axes pass.',
    ].join('\n\n');
    created.push(
      createJob(store, {
        title: `Verify: ${parent.title}`.slice(0, 120),
        kind: 'verify',
        priority: (parent.priority ?? 0) + 1,
        prompt,
        contextPaths: parent.contextPaths ?? files,
        parentJobId: parent.id,
        expertId: pick.id,
        expertScore: pick.score,
        staffQuery: query,
        successCriteria: criteria,
        verificationCommands: parent.verificationCommands,
        surfaceKind: parent.surfaceKind,
      }),
    );
  } else {
    // Parallel Standards ∥ Spec so neither axis pollutes the other.
    const standardsPick = await pickVerifyExpert(
      'code review standards smells conventions AGENTS.md',
      parentExpert,
    );
    const blocked = new Set(
      [standardsPick.id].filter((id): id is string => id !== undefined && id.length > 0),
    );
    const specPick = await pickVerifyExpert(
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
        title: `Verify standards: ${parent.title}`.slice(0, 120),
        kind: 'verify',
        priority: (parent.priority ?? 0) + 1,
        prompt: standardsPrompt,
        contextPaths: parent.contextPaths ?? files,
        parentJobId: parent.id,
        expertId: standardsPick.id,
        expertScore: standardsPick.score,
        reviewAxis: 'standards',
        staffQuery: 'code review standards smells conventions',
        successCriteria: ['Emit Standards-axis JSON verdict'],
        verificationCommands: parent.verificationCommands,
        surfaceKind: parent.surfaceKind ?? 'none',
      }),
      createJob(store, {
        title: `Verify spec: ${parent.title}`.slice(0, 120),
        kind: 'verify',
        priority: (parent.priority ?? 0) + 1,
        prompt: specPrompt,
        contextPaths: parent.contextPaths ?? files,
        parentJobId: parent.id,
        expertId: specPick.id ?? standardsPick.id,
        expertScore: specPick.score ?? standardsPick.score,
        reviewAxis: 'spec',
        staffQuery: 'code review correctness spec acceptance',
        successCriteria: ['Emit Spec-axis JSON verdict'],
        verificationCommands: parent.verificationCommands,
        surfaceKind: parent.surfaceKind ?? 'none',
      }),
    );
  }

  const ids = created.map((j) => j.id).join(', ');
  patchJob(store, parent.id, {
    notes: [parent.notes, `verify_chain: enqueued ${ids}`].filter(Boolean).join('\n'),
  });
  if (agent !== undefined) {
    requestJobSchedulePump({ store, agent });
  }
  return created[0];
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
      'You are a debug fixer. Establish a tight red-capable repro before hypothesising; then apply the smallest fix. Do not expand scope.',
      `Parent job: ${parent.id}`,
      `Verify job: ${verify.id}`,
      verify.resultSummary !== undefined
        ? `Verify findings:\n${verify.resultSummary.slice(0, 3000)}`
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
    reproCommand: parent.reproCommand,
    parentJobId: parent.id,
    expertId: pick?.expert.id,
    expertScore: pick?.score,
    staffQuery: query,
    successCriteria: [
      'Tight repro goes red then green after the fix',
      'Address verify required_fixes',
      'Re-verify with checks or VerifySurface',
    ],
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

function verifyChildrenReady(children: readonly JobRecord[]): boolean {
  if (children.length === 0) return false;
  return children.every((c) => c.status === 'done' || c.status === 'failed');
}

function aggregateVerifyVerdict(children: readonly JobRecord[]): JobVerifyVerdict {
  let anyFailed = false;
  for (const child of children) {
    const v =
      resolveVerifyChildVerdict(child) ??
      (child.status === 'failed' ? 'failed' : undefined) ??
      'failed';
    if (v !== 'passed') anyFailed = true;
  }
  return anyFailed ? 'failed' : 'passed';
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
    // Stamp structured verdict from summary parse (merge later reads the field only).
    const stamped =
      resolveVerifyChildVerdictForStamp(job) ??
      (job.status === 'failed' ? ('failed' as const) : undefined);
    if (stamped === 'passed' || stamped === 'failed') {
      patchJob(store, job.id, { verifyVerdict: stamped });
    }
    const children = findVerifyChildren(parent.id, listJobs(store));
    const axisNote = `verify_chain: ${job.id}${job.reviewAxis !== undefined ? ` axis=${job.reviewAxis}` : ''} verdict=${
      stamped ?? 'missing'
    }`;
    patchJob(store, parent.id, {
      notes: [
        parent.notes,
        axisNote,
        makerCheckerCollision(parent.expertId, job.expertId)
          ? 'verify_chain: MAKER_CHECKER_COLLISION same expertId on implement+verify'
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    if (!verifyChildrenReady(children)) return;
    const verdict = aggregateVerifyVerdict(children);
    const latestParent = getJob(store, parent.id) ?? parent;
    patchJob(store, parent.id, {
      notes: [latestParent.notes, `verify_chain: aggregate verdict=${verdict}`]
        .filter(Boolean)
        .join('\n'),
    });
    if (verdict === 'failed') {
      const failedChild =
        children.find((c) => resolveVerifyChildVerdict(c) !== 'passed') ?? children[0]!;
      await enqueueDebugJobForVerify(store, latestParent, failedChild, agent);
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

  const children = findVerifyChildren(input.job.id, input.jobs);
  if (children.length === 0) {
    return {
      ok: false,
      reason:
        'No verify child Job yet — wait for the automatic verify chain (Maker≠Checker) before MergeJob.',
    };
  }
  for (const verify of children) {
    if (makerCheckerCollision(input.job.expertId, verify.expertId)) {
      return {
        ok: false,
        reason: `Maker≠Checker hard reject: implement and verify share expertId=${input.job.expertId ?? ''}.`,
      };
    }
  }
  if (!verifyChildrenReady(children)) {
    const pending = children.find((c) => c.status !== 'done' && c.status !== 'failed');
    return {
      ok: false,
      reason: `Verify job ${pending?.id ?? children[0]!.id} is still ${pending?.status ?? 'pending'} — wait for verdict before merge.`,
    };
  }
  // Dual-axis: require both standards + spec when those axes were enqueued.
  const axes = new Set(children.map((c) => c.reviewAxis).filter(Boolean));
  if (axes.has('standards') !== axes.has('spec') && axes.size > 0) {
    return {
      ok: false,
      reason: 'Verify chain incomplete — both Standards and Spec axis Jobs are required.',
    };
  }
  const verdict = aggregateVerifyVerdict(children);
  if (verdict !== 'passed') {
    const failed = children.find((c) => resolveVerifyChildVerdict(c) !== 'passed');
    return {
      ok: false,
      reason: `Verify job ${failed?.id ?? children[0]!.id} verdict=${
        resolveVerifyChildVerdict(failed ?? children[0]!) ?? 'missing'
      } — fix via debug/implement requeue before merge.`,
    };
  }
  return { ok: true };
}
