/**
 * Host-callable Conductor Job operations (no LLM).
 * Ledger/inbox/tools helpers are the source of truth; RPC/SDK wire through here.
 */

import type { JobSnapshot } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import {
  listUnreadJobInbox,
  markJobInboxRead,
  readJobInbox,
  renderJobInboxBrief,
  type JobInboxEvent,
} from './job-inbox';
import { jobRecordToSnapshot } from './job-emit';
import {
  createJob,
  getJob,
  listJobs,
  type JobDeliveryMode,
  type JobKind,
  type JobRecord,
  type JobStatus,
} from './job-ledger';
import { dispatchMergeLand } from './job-land';
import { evaluateMergeTrust, mergeTrustInputFromLedger } from './job-merge-trust';
import { patchJobAndNotify } from './job-notify';
import { dispatchPushRemote, evaluatePushTrust, resolvePushRemoteRef } from './job-push';
import {
  CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT,
  resolveConductorProjectMode,
  setConductorProjectModeMaxConcurrent,
  type ConductorProjectMode,
} from './job-project-mode';
import {
  formatJobStripLine,
  gcConductorJobWorktrees,
  resolveConductorPoolConfig,
  summarizeJobStrip,
} from './job-runtime';
import { splitUserMessageIntoJobIntents, type SplitJobIntent } from './job-split';
import { ackCreatedJobs, renderJobInspect } from './job-tools';
import { cancelJobWorker, resumeJobs, steerJobWorker } from './job-worker';

export type { ConductorProjectMode };

export interface JobInspectResult {
  readonly job: JobSnapshot;
  readonly text: string;
}

export interface JobInboxResult {
  readonly events: readonly JobInboxEvent[];
  readonly marked: number;
  readonly text: string;
}

export interface JobCreateInput {
  readonly title: string;
  readonly kind?: JobKind;
  readonly priority?: number;
  readonly prompt?: string;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
  readonly successCriteria?: readonly string[];
  readonly mustNotTouch?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly testSeams?: readonly string[];
  readonly tddMode?: JobRecord['tddMode'];
  readonly reproCommand?: string;
  readonly blockedByJobIds?: readonly string[];
  readonly deliveryMode?: JobDeliveryMode;
  readonly parentJobId?: string;
  readonly autoSplit?: boolean;
  readonly surfaceKind?: JobRecord['surfaceKind'];
}

export interface JobCreateResult {
  readonly jobs: readonly JobSnapshot[];
  readonly text: string;
}

export interface JobActionResult {
  readonly ok: boolean;
  readonly job?: JobSnapshot;
  readonly text: string;
  readonly error?: string;
}

export interface JobResumeResult {
  readonly ok: boolean;
  readonly resumed: readonly JobSnapshot[];
  readonly text: string;
  readonly error?: string;
}

export interface JobMergeInput {
  readonly jobId: string;
  readonly approve: boolean;
  readonly summary?: string;
  readonly diffLines?: number;
  readonly hasConflict?: boolean;
  readonly checksGreen?: boolean;
  readonly forceUserConfirm?: boolean;
  readonly paths?: readonly string[];
}

export interface JobMergeResult {
  readonly ok: boolean;
  readonly job?: JobSnapshot;
  readonly mergeJob?: JobSnapshot;
  readonly text: string;
  readonly error?: string;
}

export interface JobPushInput {
  readonly jobId: string;
  readonly approve: boolean;
  readonly summary?: string;
  readonly remote?: string;
  readonly ref?: string;
  readonly remoteRef?: string;
  readonly forceUserConfirm?: boolean;
}

export interface JobPushResult {
  readonly ok: boolean;
  readonly job?: JobSnapshot;
  readonly pushJob?: JobSnapshot;
  readonly text: string;
  readonly error?: string;
}

export interface JobGcWorktreesResult {
  readonly removedJobIds: readonly string[];
  readonly removed: number;
  readonly kept: number;
}

export interface JobSetProjectModeResult {
  readonly mode: ConductorProjectMode;
  readonly maxConcurrent: number;
  readonly text: string;
}

function snapshot(job: JobRecord): JobSnapshot {
  return jobRecordToSnapshot(job);
}

export function jobList(store: ToolStore): JobSnapshot[] {
  return [...listJobs(store)]
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
    .map(snapshot);
}

export function jobInspect(store: ToolStore, jobId: string): JobInspectResult | undefined {
  const job = getJob(store, jobId);
  if (job === undefined) return undefined;
  return { job: snapshot(job), text: renderJobInspect(job) };
}

export function jobInbox(
  store: ToolStore,
  options: { readonly markRead?: boolean; readonly limit?: number } = {},
): JobInboxResult {
  const limit = options.limit ?? 20;
  const unread = listUnreadJobInbox(store).slice(-limit);
  let marked = 0;
  if (options.markRead === true && unread.length > 0) {
    marked = markJobInboxRead(
      store,
      unread.map((e) => e.id),
    );
  }
  const strip = summarizeJobStrip(store);
  const unreadCount = listUnreadJobInbox(store).length;
  const events =
    unread.length > 0 ? unread : readJobInbox(store).events.slice(-limit);
  const lines = [formatJobStripLine(strip, unreadCount), renderJobInboxBrief(events)];
  if (options.markRead === true && unread.length > 0) {
    lines.push(`marked_read=${marked}`);
  }
  return { events, marked, text: lines.join('\n') };
}

export async function jobSteer(
  store: ToolStore,
  input: {
    readonly jobId: string;
    readonly message: string;
    readonly status?: JobStatus;
    readonly agent?: Agent;
  },
): Promise<JobActionResult> {
  const result = steerJobWorker({
    store,
    agent: input.agent,
    jobId: input.jobId,
    message: input.message,
    status: input.status,
  });
  if (!result.ok || result.job === undefined) {
    return { ok: false, text: result.error ?? `Job not found: ${input.jobId}`, error: result.error };
  }
  return {
    ok: true,
    job: snapshot(result.job),
    text: `ACK ${result.job.id} state=${result.job.status}\nsteered=${result.steered}`,
  };
}

export async function jobCancel(
  store: ToolStore,
  input: { readonly jobId: string; readonly reason?: string; readonly agent?: Agent },
): Promise<JobActionResult> {
  const result = await cancelJobWorker({
    store,
    agent: input.agent,
    jobId: input.jobId,
    reason: input.reason,
  });
  if (!result.ok || result.job === undefined) {
    return { ok: false, text: result.error ?? `Job not found: ${input.jobId}`, error: result.error };
  }
  return {
    ok: true,
    job: snapshot(result.job),
    text: `ACK ${result.job.id} state=${result.job.status}\naborted=${result.aborted}`,
  };
}

export async function jobResume(
  store: ToolStore,
  input: { readonly jobId?: string; readonly answer?: string; readonly agent?: Agent } = {},
): Promise<JobResumeResult> {
  const result = await resumeJobs({
    store,
    agent: input.agent,
    jobId: input.jobId,
    answer: input.answer,
  });
  if (!result.ok) {
    return {
      ok: false,
      resumed: [],
      text: result.error ?? 'Resume failed',
      error: result.error,
    };
  }
  return {
    ok: true,
    resumed: result.resumed.map(snapshot),
    text: [result.message, ...result.resumed.map((j) => `${j.id} ${j.status}`)].join('\n'),
  };
}

export async function jobCreate(
  store: ToolStore,
  input: JobCreateInput,
  agent?: Agent,
): Promise<JobCreateResult> {
  const pool = resolveConductorPoolConfig(process.env, { store });
  const intents =
    input.autoSplit === true
      ? splitUserMessageIntoJobIntents(input.prompt?.trim() || input.title)
      : [{ title: input.title, prompt: input.prompt ?? input.title }];

  const codingKind =
    input.kind === undefined || input.kind === 'task' || input.kind === 'implement';
  const created = intents.map((intent, index) =>
    createJob(store, {
      title: intent.title || input.title,
      kind: input.kind,
      priority: (input.priority ?? 0) + (intents.length - index),
      prompt: intent.prompt,
      ownershipPaths: input.ownershipPaths,
      contextPaths: input.contextPaths,
      successCriteria: input.successCriteria,
      mustNotTouch: input.mustNotTouch,
      verificationCommands: input.verificationCommands,
      testSeams: input.testSeams,
      tddMode: input.tddMode ?? (codingKind ? 'preferred' : undefined),
      reproCommand: input.reproCommand,
      blockedByJobIds: input.blockedByJobIds,
      deliveryMode: input.deliveryMode === 'standard' ? undefined : input.deliveryMode,
      parentJobId: input.parentJobId,
      surfaceKind: input.surfaceKind,
      sessionRepoPath: agent?.config.cwd,
    }),
  );

  const ack = await ackCreatedJobs({ store, agent, created, pool });
  return {
    jobs: created.map((j) => snapshot(getJob(store, j.id) ?? j)),
    text: ack.output,
  };
}

export async function jobCreateBatch(
  store: ToolStore,
  inputs: readonly JobCreateInput[],
  agent?: Agent,
): Promise<JobCreateResult> {
  const pool = resolveConductorPoolConfig(process.env, { store });
  const created: JobRecord[] = [];
  for (const input of inputs) {
    const codingKind =
      input.kind === undefined || input.kind === 'task' || input.kind === 'implement';
    created.push(
      createJob(store, {
        title: input.title,
        kind: input.kind,
        priority: input.priority,
        prompt: input.prompt ?? input.title,
        ownershipPaths: input.ownershipPaths,
        contextPaths: input.contextPaths,
        successCriteria: input.successCriteria,
        mustNotTouch: input.mustNotTouch,
        verificationCommands: input.verificationCommands,
        testSeams: input.testSeams,
        tddMode: input.tddMode ?? (codingKind ? 'preferred' : undefined),
        reproCommand: input.reproCommand,
        blockedByJobIds: input.blockedByJobIds,
        deliveryMode: input.deliveryMode === 'standard' ? undefined : input.deliveryMode,
        parentJobId: input.parentJobId,
        surfaceKind: input.surfaceKind,
        sessionRepoPath: agent?.config.cwd,
      }),
    );
  }
  const ack = await ackCreatedJobs({
    store,
    agent,
    created,
    pool,
    batchLabel: 'rpc batch',
  });
  return {
    jobs: created.map((j) => snapshot(getJob(store, j.id) ?? j)),
    text: ack.output,
  };
}

export async function jobMerge(
  store: ToolStore,
  input: JobMergeInput,
  agent?: Agent,
): Promise<JobMergeResult> {
  const existing = getJob(store, input.jobId);
  if (existing === undefined) {
    return { ok: false, text: `Job not found: ${input.jobId}`, error: `Job not found: ${input.jobId}` };
  }

  if (!input.approve) {
    const job = patchJobAndNotify(
      store,
      input.jobId,
      {
        status: existing.status === 'done' ? 'done' : 'blocked',
        notes: [existing.notes, `merge: rejected ${input.summary ?? ''}`].filter(Boolean).join('\n'),
      },
      {
        agent,
        summary: `merge: rejected ${input.summary ?? ''}`.trim(),
      },
    );
    return {
      ok: true,
      job: job ? snapshot(job) : undefined,
      text: `ACK ${job!.id} state=${job!.status}\nMerge rejected/held.`,
    };
  }

  const autoPermission = agent?.permission?.mode === 'auto';
  const trust = evaluateMergeTrust({
    ...mergeTrustInputFromLedger({
      job: existing,
      jobs: listJobs(store),
      claim: {
        approve: true,
        diffLines: input.diffLines,
        hasConflict: input.hasConflict,
        checksGreen: input.checksGreen,
        paths: input.paths,
        summary: input.summary,
        forceUserConfirm: !autoPermission && input.forceUserConfirm === true,
      },
    }),
    ...(autoPermission ? { waiveUserConfirmHolds: true } : {}),
  });

  if (!trust.ok) {
    const rejected = trust.mode === 'reject';
    const holdNote = rejected
      ? `merge: reject — ${trust.reason}`
      : `merge: hold — ${trust.reason}`;
    const job = patchJobAndNotify(
      store,
      input.jobId,
      {
        status: 'blocked',
        notes: [existing.notes, holdNote].filter(Boolean).join('\n'),
      },
      { agent, summary: holdNote },
    );
    return {
      ok: false,
      job: job ? snapshot(job) : undefined,
      text: rejected
        ? `Merge rejected: ${trust.reason}`
        : `Merge held: ${trust.reason}`,
      error: trust.reason,
    };
  }

  const dispatch = dispatchMergeLand({
    store,
    sourceJob: existing,
    trustMode: trust.mode,
    trustReason: trust.reason,
    summary: input.summary,
    kaos: agent?.kaos,
    repoPath: existing.repoRoot ?? agent?.config.cwd,
    agent,
  });
  const latest = getJob(store, input.jobId) ?? existing;
  return {
    ok: true,
    job: snapshot(latest),
    mergeJob: dispatch.mergeJob ? snapshot(dispatch.mergeJob) : undefined,
    text: [
      `Merge approved (${trust.mode}). ${trust.reason}`,
      dispatch.mergeJob
        ? `Execution offloaded to landing worker ${dispatch.mergeJob.id}`
        : 'Dispatch failed — merge held for manual resolve.',
    ].join('\n'),
  };
}

export async function jobPush(
  store: ToolStore,
  input: JobPushInput,
  agent?: Agent,
): Promise<JobPushResult> {
  const existing = getJob(store, input.jobId);
  if (existing === undefined) {
    return { ok: false, text: `Job not found: ${input.jobId}`, error: `Job not found: ${input.jobId}` };
  }

  if (!input.approve) {
    const job = patchJobAndNotify(
      store,
      input.jobId,
      {
        status: existing.status === 'done' ? 'done' : 'blocked',
        notes: [existing.notes, `push: rejected ${input.summary ?? ''}`].filter(Boolean).join('\n'),
      },
      {
        agent,
        summary: `push: rejected ${input.summary ?? ''}`.trim(),
      },
    );
    return {
      ok: true,
      job: job ? snapshot(job) : undefined,
      text: `ACK ${job!.id} state=${job!.status}\nPush rejected/held.`,
    };
  }

  const trust = evaluatePushTrust({
    approve: true,
    forceUserConfirm: input.forceUserConfirm === true,
    remote: input.remote ?? 'origin',
    localRef: input.ref,
    remoteRef: input.remoteRef,
  });

  if (!trust.ok) {
    const holdNote = `push: hold — ${trust.reason}`;
    const job = patchJobAndNotify(
      store,
      input.jobId,
      {
        status: 'blocked',
        notes: [existing.notes, holdNote].filter(Boolean).join('\n'),
      },
      { agent, summary: holdNote },
    );
    return {
      ok: false,
      job: job ? snapshot(job) : undefined,
      text: `Push held: ${trust.reason}`,
      error: trust.reason,
    };
  }

  const dispatch = dispatchPushRemote({
    store,
    sourceJob: existing,
    trustReason: trust.reason,
    remote: input.remote ?? 'origin',
    localRef: input.ref,
    remoteRef: input.remoteRef,
    summary: input.summary,
    kaos: agent?.kaos,
    repoPath: existing.repoRoot ?? agent?.config.cwd,
    agent,
  });
  const latest = getJob(store, input.jobId) ?? existing;
  const remoteHint =
    resolvePushRemoteRef({ explicit: input.remoteRef, job: existing }) === 'gh-pages'
      ? ' Target remoteRef=gh-pages (Pages); Pages enable runs after push when possible.'
      : '';
  return {
    ok: true,
    job: snapshot(latest),
    pushJob: dispatch.pushJob ? snapshot(dispatch.pushJob) : undefined,
    text: [
      `Push approved. ${trust.reason}${remoteHint}`,
      dispatch.pushJob
        ? `Execution offloaded to push worker ${dispatch.pushJob.id}`
        : 'Dispatch failed — push held for manual resolve.',
    ].join('\n'),
  };
}

export function jobPreviewSplit(text: string): readonly SplitJobIntent[] {
  return splitUserMessageIntoJobIntents(text);
}

/** Persist session project-mode pool override (env SUPERLIORA_CONDUCTOR_MAX_CONCURRENT still wins). */
export function jobSetProjectMode(
  store: ToolStore,
  mode: ConductorProjectMode,
): JobSetProjectModeResult {
  setConductorProjectModeMaxConcurrent(store, mode);
  const resolved = resolveConductorProjectMode(store) ?? mode;
  const maxConcurrent = CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT[resolved];
  return {
    mode: resolved,
    maxConcurrent,
    text: `Project mode → ${resolved} (pool default maxConcurrent=${String(maxConcurrent)})`,
  };
}

export async function jobGcWorktrees(
  store: ToolStore,
  input: { readonly agent?: Agent; readonly dryRun?: boolean } = {},
): Promise<JobGcWorktreesResult> {
  const kaos = input.agent?.kaos;
  if (kaos === undefined) {
    return { removedJobIds: [], removed: 0, kept: 0 };
  }
  const pool = resolveConductorPoolConfig(process.env, { store });
  const result = await gcConductorJobWorktrees({
    kaos,
    store,
    failTtlDays: pool.failTtlDays,
    dryRun: input.dryRun,
  });
  return {
    removedJobIds: result.removedJobIds,
    removed: result.gc.removed,
    kept: result.gc.kept,
  };
}
