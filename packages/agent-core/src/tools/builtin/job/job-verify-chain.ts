/**
 * Implement → verify → (optional) debug Job chain.
 * Maker≠Checker: verify expertId must differ from the implement parent's.
 * Posture is JobKind (`verify` / `implement`), not an UltraSwarm expertRole.
 */

import type { Agent } from '../../../agent/index';
import { globalExpertSearchEngine } from '../../../expert-agents/search';
import { requestJobSchedulePump } from '../../../session/job/job-offload';
import type { ToolStore } from '../../store';
import { dispatchMergeLand } from './job-land';
import { createJob, getJob, listJobs, patchJob, type JobRecord } from './job-ledger';
import { surfaceRequiresVisualProof } from './job-surface';
import { STAFF_MIN_EXPERT_SCORE } from './job-staff';

export type JobVerifyVerdict = 'passed' | 'failed' | 'not_run' | 'not_applicable';

/**
 * Merge/read path: prefer stamped verifyVerdict; else parse dual-axis JSON from
 * the summary (same parser as completion stamp). Prose "PASS" still does not count.
 * Resume ledgers often have JSON in the summary with a missing field — heal via parse.
 */
export function resolveVerifyChildVerdict(job: JobRecord): JobVerifyVerdict | undefined {
  if (job.verifyVerdict === 'passed' || job.verifyVerdict === 'failed') {
    return job.verifyVerdict;
  }
  return parseVerifyVerdict(job.resultSummary);
}

/** Stamp helper: structured field, else parse summary (completion path only). */
export function resolveVerifyChildVerdictForStamp(job: JobRecord): JobVerifyVerdict | undefined {
  return resolveVerifyChildVerdict(job);
}

/**
 * Persist parseable summary JSON onto verifyVerdict (and un-fail format-only fails).
 * Safe to call on resume / before MergeJob so older session ledgers heal in place.
 */
export function healVerifyVerdictFromSummary(
  store: ToolStore,
  job: JobRecord,
): JobRecord | undefined {
  if (job.kind !== 'verify') return undefined;
  if (job.verifyVerdict === 'passed' || job.verifyVerdict === 'failed') return undefined;
  const parsed = parseVerifyVerdict(job.resultSummary);
  if (parsed !== 'passed' && parsed !== 'failed') return undefined;
  const formatOnlyFail =
    job.status === 'failed' &&
    (job.notes?.includes('without structured verifyVerdict') === true ||
      job.resultSummary?.startsWith('structured verifyVerdict missing') === true);
  return patchJob(store, job.id, {
    verifyVerdict: parsed,
    ...(formatOnlyFail && parsed === 'passed' ? { status: 'done' as const } : {}),
    notes: [job.notes, `verify_chain: healed verifyVerdict=${parsed} from summary JSON`]
      .filter(Boolean)
      .join('\n'),
  });
}

/** Heal every verify Job that has parseable JSON but no stamped field. */
export function healAllVerifyVerdictsFromSummary(store: ToolStore): readonly JobRecord[] {
  const healed: JobRecord[] = [];
  for (const job of listJobs(store)) {
    const next = healVerifyVerdictFromSummary(store, job);
    if (next !== undefined) healed.push(next);
  }
  return healed;
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

/**
 * Cancelled verify is inert: it must not hold MergeJob, block requeue, or count
 * as an active chain member. A later done+verdict child is enough.
 */
function isInertVerifyChild(job: JobRecord): boolean {
  return job.status === 'cancelled';
}

/** Verify children that still participate in merge / requeue gating. */
export function findActiveVerifyChildren(
  parentJobId: string,
  jobs: readonly JobRecord[],
): readonly JobRecord[] {
  return findVerifyChildren(parentJobId, jobs).filter((job) => !isInertVerifyChild(job));
}

/** True when the required verify set for this parent is already enqueued. */
export function hasVerifyChild(store: ToolStore, parentJobId: string): boolean {
  // Cancelled-only history must not permanently block requeue.
  const children = findActiveVerifyChildren(parentJobId, listJobs(store));
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

function verdictFromParsedBlob(parsed: {
  readonly verdict?: string;
  readonly standards?: AxisVerdictBlob;
  readonly spec?: AxisVerdictBlob;
}): JobVerifyVerdict | undefined {
  const standards = normalizeVerdict(parsed.standards?.verdict);
  const spec = normalizeVerdict(parsed.spec?.verdict);
  if (standards !== undefined && spec !== undefined) {
    if (standards === 'passed' && spec === 'passed') return 'passed';
    return 'failed';
  }
  // Parallel axis Jobs emit only their axis blob.
  if (standards !== undefined && spec === undefined) return standards;
  if (spec !== undefined && standards === undefined) return spec;
  return normalizeVerdict(parsed.verdict);
}

function tryParseJsonObject(blob: string): JobVerifyVerdict | undefined {
  try {
    return verdictFromParsedBlob(
      JSON.parse(blob) as {
        verdict?: string;
        standards?: AxisVerdictBlob;
        spec?: AxisVerdictBlob;
      },
    );
  } catch {
    return undefined;
  }
}

/**
 * When the summary budget truncates mid-JSON, the dual-axis keys are often
 * still visible at the top of the object. Accept that shape so MergeJob is
 * not blocked by a 4k slice cutting through `findings`.
 */
function parseTruncatedDualAxisVerdict(text: string): JobVerifyVerdict | undefined {
  if (!/"verdict"\s*:/i.test(text) || !/"standards"\s*:/i.test(text) || !/"spec"\s*:/i.test(text)) {
    return undefined;
  }
  const top = text.match(/\{\s*"verdict"\s*:\s*"(pass|fail|passed|failed)"/i);
  const standards = text.match(
    /"standards"\s*:\s*\{\s*"verdict"\s*:\s*"(pass|fail|passed|failed)"/i,
  );
  const spec = text.match(/"spec"\s*:\s*\{\s*"verdict"\s*:\s*"(pass|fail|passed|failed)"/i);
  if (standards?.[1] !== undefined && spec?.[1] !== undefined) {
    const s = normalizeVerdict(standards[1]);
    const p = normalizeVerdict(spec[1]);
    if (s === 'passed' && p === 'passed') return 'passed';
    if (s !== undefined && p !== undefined) return 'failed';
  }
  if (top?.[1] !== undefined) return normalizeVerdict(top[1]);
  return undefined;
}

/**
 * Parse structured verify verdict from worker summary.
 * Prefer dual-axis JSON (standards + spec); overall pass only when both axes pass.
 * Falls back to a single top-level verdict, a `verdict: pass|fail` line, or a
 * truncated dual-axis blob (summary budget often cuts mid-`findings`).
 */
export function parseVerifyVerdict(summary: string | undefined): JobVerifyVerdict | undefined {
  if (summary === undefined || summary.trim().length === 0) return undefined;
  const text = summary.trim();

  // Prefer fenced ```json blocks — workers usually put the contract there.
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body === undefined || body.length === 0) continue;
    const fromFence = tryParseJsonObject(body) ?? parseTruncatedDualAxisVerdict(body);
    if (fromFence !== undefined) return fromFence;
  }

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const fromSlice = tryParseJsonObject(text.slice(start, end + 1));
      if (fromSlice !== undefined) return fromSlice;
    }
  } catch {
    // fall through
  }

  const truncated = parseTruncatedDualAxisVerdict(text);
  if (truncated !== undefined) return truncated;

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
    void requestJobSchedulePump({ store, agent });
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
    void requestJobSchedulePump({ store, agent });
  }
  return debug;
}

function verifyChildrenReady(children: readonly JobRecord[]): boolean {
  // Callers pass active (non-cancelled) children only.
  if (children.length === 0) return false;
  return children.every((c) => c.status === 'done' || c.status === 'failed');
}

/**
 * Timeout / route_fail / env (frames=0, bash|pnpm ENOENT) missing-JSON is VOID
 * ceremony — not a dual-axis format gap worth structured_verdict_retry hops.
 */
function isVoidEnvOrTimeoutMissing(job: JobRecord): boolean {
  const blob = [job.notes, job.resultSummary].filter(Boolean).join('\n').toLowerCase();
  if (blob.length === 0) return false;
  return (
    /\btimeout\b|\btimed out\b|route_fail/.test(blob) ||
    /frames\s*=\s*0/.test(blob) ||
    /\bbash\b[\s\S]{0,40}\benoent\b|\benoent\b[\s\S]{0,40}\bbash\b/.test(blob) ||
    /\bpnpm\b[\s\S]{0,40}\benoent\b|\benoent\b[\s\S]{0,40}\bpnpm\b/.test(blob)
  );
}

/** Retry / supersede: merge + aggregate only look at the newest Job per axis. */
function latestVerifyChildrenByAxis(children: readonly JobRecord[]): JobRecord[] {
  const byAxis = new Map<string, JobRecord>();
  for (const child of children) {
    const key = child.reviewAxis ?? 'combined';
    const prev = byAxis.get(key);
    if (prev === undefined) {
      byAxis.set(key, child);
      continue;
    }
    // Missing-JSON / unparsed is VOID: never supersede a resolved sibling on the
    // same axis (timeout after pass must not poison merge).
    const childResolved = resolveVerifyChildVerdict(child) !== undefined;
    const prevResolved = resolveVerifyChildVerdict(prev) !== undefined;
    if (prevResolved && !childResolved) continue;
    if (!prevResolved && childResolved) {
      byAxis.set(key, child);
      continue;
    }
    if (
      child.updatedAt > prev.updatedAt ||
      (child.updatedAt === prev.updatedAt && child.createdAt > prev.createdAt) ||
      (child.updatedAt === prev.updatedAt &&
        child.createdAt === prev.createdAt &&
        child.id > prev.id)
    ) {
      byAxis.set(key, child);
    }
  }
  return [...byAxis.values()];
}

function aggregateVerifyVerdict(children: readonly JobRecord[]): JobVerifyVerdict {
  let anyFailed = false;
  for (const child of children) {
    // Structured field only — free-text / status alone never count as pass.
    const v = resolveVerifyChildVerdict(child) ?? 'failed';
    if (v !== 'passed') anyFailed = true;
  }
  return anyFailed ? 'failed' : 'passed';
}

const STRUCTURED_VERDICT_MISSING_NOTE =
  'verify_chain: structured verifyVerdict missing — requeue verify with dual-axis JSON';
const STRUCTURED_VERDICT_RETRY_NOTE = 'structured_verdict_retry';

function axisKey(job: JobRecord): string {
  return job.reviewAxis ?? 'combined';
}

function hasStructuredVerdictRetry(
  parentId: string,
  axis: string,
  jobs: readonly JobRecord[],
): boolean {
  return jobs.some(
    (j) =>
      j.parentJobId === parentId &&
      j.kind === 'verify' &&
      axisKey(j) === axis &&
      (j.notes?.includes(STRUCTURED_VERDICT_RETRY_NOTE) ?? false),
  );
}

/** One automatic retry when a verify finished without parseable dual-axis JSON. */
async function enqueueStructuredVerdictRetry(
  store: ToolStore,
  parent: JobRecord,
  missing: JobRecord,
  agent?: Agent,
): Promise<JobRecord | undefined> {
  const axis = axisKey(missing);
  if (hasStructuredVerdictRetry(parent.id, axis, listJobs(store))) return undefined;
  const titleBase =
    missing.reviewAxis === 'standards'
      ? `Re-verify standards: ${parent.title}`
      : missing.reviewAxis === 'spec'
        ? `Re-verify spec: ${parent.title}`
        : `Re-verify: ${parent.title}`;
  const retry = createJob(store, {
    title: titleBase.slice(0, 120),
    kind: 'verify',
    priority: (missing.priority ?? parent.priority ?? 0) + 1,
    prompt: [
      missing.prompt,
      'Previous attempt finished without structured dual-axis JSON. Emit ONLY the required verdict JSON this time.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    contextPaths: missing.contextPaths ?? parent.contextPaths,
    parentJobId: parent.id,
    expertId: missing.expertId,
    expertScore: missing.expertScore,
    reviewAxis: missing.reviewAxis,
    staffQuery: missing.staffQuery,
    successCriteria: missing.successCriteria ?? ['Emit dual-axis JSON verdict'],
    verificationCommands: missing.verificationCommands ?? parent.verificationCommands,
    surfaceKind: missing.surfaceKind ?? parent.surfaceKind,
    notes: STRUCTURED_VERDICT_RETRY_NOTE,
  });
  patchJob(store, parent.id, {
    notes: [
      getJob(store, parent.id)?.notes,
      `verify_chain: ${STRUCTURED_VERDICT_RETRY_NOTE} ${axis} → ${retry.id}`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  if (agent !== undefined) {
    void requestJobSchedulePump({ store, agent });
  }
  return retry;
}

/**
 * Handle terminal completion for chain bookkeeping.
 * - implement done → enqueue verify
 * - verify done → parse verdict; on fail enqueue debug; stamp parent notes
 * - verify done without JSON → fail + one structured-verdict retry (not Debug)
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
    // Stamp from parse/field only — never invent failed from status (free-text PASS trap).
    const stamped = resolveVerifyChildVerdictForStamp(job);
    if (stamped === 'passed' || stamped === 'failed') {
      patchJob(store, job.id, { verifyVerdict: stamped });
    } else if (job.status === 'done') {
      patchJob(store, job.id, {
        status: 'failed',
        notes: [job.notes, STRUCTURED_VERDICT_MISSING_NOTE].filter(Boolean).join('\n'),
      });
    } else if (!(job.notes?.includes('structured verifyVerdict missing') ?? false)) {
      patchJob(store, job.id, {
        notes: [job.notes, STRUCTURED_VERDICT_MISSING_NOTE].filter(Boolean).join('\n'),
      });
    }

    if (stamped === undefined) {
      // Timeout / route_fail / env missing is VOID — do not spawn structured_verdict_retry hops.
      // Free-text format gaps still get one dual-axis JSON retry (not Debug).
      if (!isVoidEnvOrTimeoutMissing(job)) {
        const retry = await enqueueStructuredVerdictRetry(store, parent, job, agent);
        if (retry !== undefined) {
          patchJob(store, parent.id, {
            notes: [
              getJob(store, parent.id)?.notes,
              `verify_chain: ${job.id}${job.reviewAxis !== undefined ? ` axis=${job.reviewAxis}` : ''} verdict=missing`,
            ]
              .filter(Boolean)
              .join('\n'),
          });
          return;
        }
      }
    }

    const children = latestVerifyChildrenByAxis(findVerifyChildren(parent.id, listJobs(store)));
    const axisNote = `verify_chain: ${job.id}${job.reviewAxis !== undefined ? ` axis=${job.reviewAxis}` : ''} verdict=${
      stamped ?? 'missing'
    }`;
    patchJob(store, parent.id, {
      notes: [
        getJob(store, parent.id)?.notes ?? parent.notes,
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
    // Debug only for stamped fail — missing JSON (incl. void timeout) is not a code bug;
    // never enqueueDebugJobForVerify on missing-JSON / unparsed verdict.
    if (verdict === 'failed') {
      const failedChild = children.find((c) => resolveVerifyChildVerdict(c) === 'failed');
      if (failedChild !== undefined) {
        await enqueueDebugJobForVerify(store, latestParent, failedChild, agent);
      }
      return;
    }
    // surface_kind=none + latest-per-axis pass → auto MergeJob land (no human click).
    // tui/web/mixed still require visual=passed via human MergeJob; do not auto-dispatch.
    if (verdict === 'passed') {
      const parentNow = getJob(store, parent.id) ?? latestParent;
      const jobsNow = listJobs(store);
      if (shouldAutoEnqueueMergeAfterVerify(parentNow, jobsNow)) {
        // Pass session cwd + kaos so land does not die with "repoPath required"
        // when the offload lane has no interactive MergeJob args (job_msvca2y6sosz8k).
        dispatchMergeLand({
          store,
          sourceJob: parentNow,
          trustMode: 'auto',
          trustReason:
            'verify_chain: latest-per-axis passed; surface_kind=none auto land (no human MergeJob click)',
          agent,
          repoPath: agent?.config?.cwd,
          kaos: agent?.kaos,
        });
      }
    }
    return;
  }

  if (job.status === 'done' && shouldEnqueueVerifyAfterDone(job)) {
    if (hasVerifyChild(store, job.id)) return;
    await enqueueVerifyJobForParent(store, job, agent);
  }
}

/**
 * Auto land after verify only when:
 * - parent is a done coding job with surface_kind=none
 * - latest-per-axis verify gate is ok (Maker≠Checker + dual-axis pass)
 * - no merge child already exists
 *
 * NEVER auto-merge tui/web/mixed — visual proof stays a human MergeJob path.
 * Does not touch job-merge-trust visual gate.
 */
export function shouldAutoEnqueueMergeAfterVerify(
  parent: JobRecord,
  jobs: readonly JobRecord[],
): boolean {
  if (parent.kind !== 'task' && parent.kind !== 'implement') return false;
  if (parent.status !== 'done') return false;
  if (parent.surfaceKind !== 'none') return false;
  if (jobs.some((j) => j.parentJobId === parent.id && j.kind === 'merge')) return false;
  return evaluateVerifyChainForMerge({ job: parent, jobs }).ok;
}

/** True when a done coding job has a green verify chain and no merge child yet. */
export function isMergeReadyJob(parent: JobRecord, jobs: readonly JobRecord[]): boolean {
  if (parent.kind !== 'task' && parent.kind !== 'implement') return false;
  if (parent.status !== 'done') return false;
  if (jobs.some((j) => j.parentJobId === parent.id && j.kind === 'merge')) return false;
  return evaluateVerifyChainForMerge({ job: parent, jobs }).ok;
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

  // Cancelled verify is inert — do not wait on it; later done+verdict is enough.
  // Never auto-approve when only cancelled (or no) verify children exist.
  const allChildren = findActiveVerifyChildren(input.job.id, input.jobs);
  if (allChildren.length === 0) {
    return {
      ok: false,
      reason:
        'No verify child Job yet — wait for the automatic verify chain (Maker≠Checker) before MergeJob.',
    };
  }
  // Superseded retries: only the newest Job per axis gates merge.
  const children = latestVerifyChildrenByAxis(allChildren);
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
  // latestVerifyChildrenByAxis already drops void missing when a resolved sibling
  // exists on that axis — timeout after pass is not poison.
  const verdict = aggregateVerifyVerdict(children);
  if (verdict !== 'passed') {
    const failed = children.find((c) => resolveVerifyChildVerdict(c) !== 'passed') ?? children[0]!;
    const childVerdict = resolveVerifyChildVerdict(failed);
    if (childVerdict === undefined) {
      return {
        ok: false,
        reason: `Verify job ${failed.id} verdict=missing — requeue verify to emit dual-axis JSON before merge (do not MergeJob / Debug for format gaps).`,
      };
    }
    return {
      ok: false,
      reason: `Verify job ${failed.id} verdict=${childVerdict} — fix via debug/implement requeue before merge.`,
    };
  }
  return { ok: true };
}
