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
  patchJob,
  upsertJob,
  type JobDeliveryMode,
  type JobKind,
  type JobRecord,
  type JobStatus,
} from './job-ledger';
import { dispatchMergeLand } from './job-land';
import { jobMayLandToMain } from './job-land-gate';
import { evaluateMergeTrust, mergeTrustInputFromLedger } from './job-merge-trust';
import { patchJobAndNotify } from './job-notify';
import { dispatchPushRemote, evaluatePushTrust, resolvePushRemoteRef } from './job-push';
import { synthesizeSuccessCriteria } from './job-brief';
import {
  CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT,
  deliveryClassFromProjectMode,
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
import {
  allocateUniqueSessionName,
  archiveWorkspaceSession,
  classifyWorkspaceShelf,
  findWorkspaceSession,
  listWorkspaceSessions,
  workspaceEntryToJobRecord,
  type WorkspaceSessionEntry,
  type WorkspaceSessionShelf,
} from './job-workspace-catalog';
import { findOwnershipHolder, listRunningOwnershipHolders } from './job-ownership';
import type { JobLandChoice } from './job-store-key';

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
  readonly deliveryClass?: JobRecord['deliveryClass'];
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

export type { WorkspaceSessionEntry, WorkspaceSessionShelf };

export interface WorkspaceSessionRow extends WorkspaceSessionEntry {
  readonly shelf: WorkspaceSessionShelf;
  readonly local: boolean;
}

export interface JobWorkspaceCatalogResult {
  readonly rows: readonly WorkspaceSessionRow[];
  readonly text: string;
}

export interface JobAdoptResult {
  readonly ok: boolean;
  readonly job?: JobSnapshot;
  readonly adopted: boolean;
  readonly text: string;
  readonly error?: string;
}

export type JobLandChoiceKind = JobLandChoice;

export interface JobLandChoiceInput {
  readonly jobId: string;
  readonly choice: 'keep' | 'apply' | 'pr';
}

export interface JobRenameInput {
  readonly jobId: string;
  readonly name: string;
}

function snapshot(job: JobRecord): JobSnapshot {
  return jobRecordToSnapshot(job);
}

export function jobList(store: ToolStore): JobSnapshot[] {
  return [...listJobs(store)]
    .toSorted((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
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
  const successCriteria =
    input.successCriteria !== undefined && input.successCriteria.length > 0
      ? input.successCriteria
      : codingKind
        ? synthesizeSuccessCriteria({ title: input.title, prompt: input.prompt })
        : input.successCriteria;
  const deliveryClass =
    input.deliveryClass ??
    (codingKind ? deliveryClassFromProjectMode(resolveConductorProjectMode(store)) : undefined);
  const created = intents.map((intent, index) =>
    createJob(store, {
      title: intent.title || input.title,
      kind: input.kind,
      priority: (input.priority ?? 0) + (intents.length - index),
      prompt: intent.prompt,
      ownershipPaths: input.ownershipPaths,
      contextPaths: input.contextPaths,
      successCriteria,
      mustNotTouch: input.mustNotTouch,
      verificationCommands: input.verificationCommands,
      testSeams: input.testSeams,
      tddMode: input.tddMode ?? (codingKind ? 'preferred' : undefined),
      reproCommand: input.reproCommand,
      blockedByJobIds: input.blockedByJobIds,
      deliveryMode: input.deliveryMode === 'standard' ? undefined : input.deliveryMode,
      deliveryClass,
      parentJobId: input.parentJobId,
      surfaceKind: input.surfaceKind,
      sessionRepoPath: agent?.config.cwd,
    }),
  );

  const overlapLines = overlapWarningLines(store, created);
  const ack = await ackCreatedJobs({
    store,
    agent,
    created,
    pool,
    extraLines: overlapLines,
  });
  return {
    jobs: created.map((j) => snapshot(getJob(store, j.id) ?? j)),
    text: ack.output,
  };
}

function overlapWarningLines(store: ToolStore, created: readonly JobRecord[]): readonly string[] {
  const holders = listRunningOwnershipHolders(store);
  const lines: string[] = [];
  for (const job of created) {
    const hit = findOwnershipHolder(holders, job);
    if (hit === undefined) continue;
    const name = hit.holder.sessionName ?? hit.holder.id;
    lines.push(
      `overlap: ${job.sessionName ?? job.id} shares ${hit.path} with live session ${name} — files are worktree-isolated; watch ports/DB.`,
    );
  }
  return lines;
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
        successCriteria:
          input.successCriteria !== undefined && input.successCriteria.length > 0
            ? input.successCriteria
            : codingKind
              ? synthesizeSuccessCriteria({ title: input.title, prompt: input.prompt })
              : input.successCriteria,
        mustNotTouch: input.mustNotTouch,
        verificationCommands: input.verificationCommands,
        testSeams: input.testSeams,
        tddMode: input.tddMode ?? (codingKind ? 'preferred' : undefined),
        reproCommand: input.reproCommand,
        blockedByJobIds: input.blockedByJobIds,
        deliveryMode: input.deliveryMode === 'standard' ? undefined : input.deliveryMode,
        deliveryClass:
          input.deliveryClass ??
          (codingKind
            ? deliveryClassFromProjectMode(resolveConductorProjectMode(store))
            : undefined),
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
    extraLines: overlapWarningLines(store, created),
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

export function jobWorkspaceCatalog(
  store: ToolStore,
  input: { readonly workDir?: string; readonly homeDir?: string } = {},
): JobWorkspaceCatalogResult {
  const workDir = input.workDir?.trim();
  if (workDir === undefined || workDir.length === 0) {
    return { rows: [], text: 'workspace catalog: no workDir' };
  }
  const localIds = new Set(listJobs(store).map((job) => job.id));
  const rows = listWorkspaceSessions({
    workDir,
    homeDir: input.homeDir,
  }).map((row) => ({ ...row, local: localIds.has(row.jobId) }));
  const active = rows.filter((r) => r.shelf === 'active').length;
  const recent = rows.filter((r) => r.shelf === 'recent').length;
  const archived = rows.filter((r) => r.shelf === 'archived').length;
  return {
    rows,
    text: `workspace sessions: ${String(rows.length)} (active ${String(active)}, recent ${String(recent)}, archived ${String(archived)})`,
  };
}

export async function jobAdoptWorkspaceSession(
  store: ToolStore,
  input: {
    readonly jobId: string;
    readonly workDir?: string;
    readonly homeDir?: string;
    readonly agent?: Agent;
  },
): Promise<JobAdoptResult> {
  const workDir = input.workDir?.trim();
  if (workDir === undefined || workDir.length === 0) {
    return { ok: false, adopted: false, text: '', error: 'workDir required' };
  }
  const found = findWorkspaceSession(workDir, input.jobId, input.homeDir);
  if (found === undefined) {
    return {
      ok: false,
      adopted: false,
      text: '',
      error: `workspace session not found: ${input.jobId}`,
    };
  }
  const shelf = classifyWorkspaceShelf(found);
  let adopted = false;
  let job = getJob(store, found.jobId);
  if (job === undefined) {
    let imported = workspaceEntryToJobRecord(found);
    if (shelf === 'recent' && imported.status === 'done') {
      imported = { ...imported, status: 'interrupted' };
    }
    job = upsertJob(store, imported);
    adopted = true;
  }
  if (shelf === 'archived' || job.landReceipt !== undefined) {
    return {
      ok: true,
      job: snapshot(job),
      adopted,
      text: `session ${job.id} is archived — listed only; not resumed`,
    };
  }
  if (job.status === 'running' || job.status === 'needs_user') {
    return {
      ok: true,
      job: snapshot(job),
      adopted,
      text: `session ${job.id} already live in this chat`,
    };
  }
  if (job.status === 'done' && job.landReceipt === undefined) {
    job =
      patchJob(store, job.id, {
        status: 'interrupted',
        notes: [job.notes, 'workspace-catalog: continue here'].filter(Boolean).join('\n'),
      }) ?? job;
  }
  const resumed = await resumeJobs({
    store,
    agent: input.agent,
    jobId: job.id,
  });
  const latest = getJob(store, job.id) ?? job;
  return {
    ok: resumed.ok,
    job: snapshot(latest),
    adopted,
    text: [
      adopted
        ? `adopted ${latest.sessionName ?? latest.id} (${latest.id}) into this chat`
        : `${latest.sessionName ?? latest.id} already on this ledger`,
      resumed.message,
    ]
      .filter(Boolean)
      .join('\n'),
    error: resumed.ok ? undefined : resumed.message,
  };
}

export function jobRenameWorkspaceSession(
  store: ToolStore,
  input: {
    readonly jobId: string;
    readonly name: string;
    readonly workDir?: string;
    readonly homeDir?: string;
  },
): JobActionResult {
  const named =
    input.workDir !== undefined && input.workDir.trim().length > 0
      ? findWorkspaceSession(input.workDir, input.jobId, input.homeDir)
      : undefined;
  const job = getJob(store, input.jobId) ?? (named !== undefined ? getJob(store, named.jobId) : undefined);
  if (job === undefined) {
    return { ok: false, text: '', error: `Job not found: ${input.jobId}` };
  }
  const workDir = input.workDir?.trim();
  const unique =
    workDir !== undefined && workDir.length > 0
      ? allocateUniqueSessionName(workDir, input.name, {
          homeDir: input.homeDir,
          excludeJobId: job.id,
        })
      : input.name.trim();
  if (unique.length === 0) {
    return { ok: false, text: '', error: 'session name cannot be empty' };
  }
  const next = patchJob(store, job.id, {
    sessionName: unique,
    sessionNamePinned: true,
  });
  return {
    ok: true,
    job: next ? snapshot(next) : undefined,
    text: `renamed ${job.id} → ${unique}`,
  };
}

export async function jobChooseLand(
  store: ToolStore,
  input: JobLandChoiceInput,
  agent?: Agent,
): Promise<JobActionResult> {
  const job = getJob(store, input.jobId);
  if (job === undefined) {
    return { ok: false, text: '', error: `Job not found: ${input.jobId}` };
  }
  if (input.choice === 'keep') {
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        landChoice: 'keep',
        notes: [job.notes, 'land: keep worktree (operator)'].filter(Boolean).join('\n'),
      },
      { agent, summary: `kept session ${job.sessionName ?? job.id} in its worktree` },
    );
    return {
      ok: true,
      job: next ? snapshot(next) : undefined,
      text: `Keep — ${job.sessionName ?? job.id} stays in its worktree. Resume anytime.`,
    };
  }
  if (input.choice === 'apply') {
    const gate = jobMayLandToMain(job);
    if (!gate.ok) {
      return { ok: false, text: '', error: gate.reason, job: snapshot(job) };
    }
    const source = patchJob(store, job.id, {
      landChoice: 'apply',
      notes: [job.notes, 'land: apply to main (operator)'].filter(Boolean).join('\n'),
    }) ?? job;
    const dispatch = dispatchMergeLand({
      store,
      sourceJob: source,
      trustMode: 'auto',
      trustReason: 'operator chose Apply',
      summary: 'operator Apply',
      kaos: agent?.kaos,
      repoPath: source.repoRoot ?? agent?.config.cwd,
      agent,
    });
    const latest = getJob(store, job.id) ?? source;
    return {
      ok: dispatch.mergeJob !== undefined,
      job: snapshot(latest),
      text:
        dispatch.mergeJob !== undefined
          ? `Apply — landing ${latest.sessionName ?? latest.id} onto local main (${dispatch.mergeJob.id}).`
          : 'Apply dispatch failed — merge held for manual resolve.',
      error: dispatch.mergeJob === undefined ? 'apply dispatch failed' : undefined,
    };
  }
  patchJob(store, job.id, {
    landChoice: 'pr',
    notes: [job.notes, 'land: open PR (operator)'].filter(Boolean).join('\n'),
  });
  const pushed = await jobPush(
    store,
    {
      jobId: job.id,
      approve: true,
      summary: 'operator PR',
      forceUserConfirm: true,
    },
    agent,
  );
  return {
    ok: pushed.ok,
    job: pushed.job,
    text: pushed.text,
    error: pushed.error,
  };
}

export function jobArchiveWorkspaceSession(
  store: ToolStore,
  input: {
    readonly jobId: string;
    readonly workDir?: string;
    readonly homeDir?: string;
  },
): JobActionResult {
  const workDir = input.workDir?.trim();
  if (workDir === undefined || workDir.length === 0) {
    return { ok: false, text: '', error: 'workDir required' };
  }
  const archived = archiveWorkspaceSession({
    workDir,
    jobId: input.jobId,
    homeDir: input.homeDir,
  });
  if (archived === undefined) {
    return { ok: false, text: '', error: `workspace session not found: ${input.jobId}` };
  }
  const local = getJob(store, input.jobId);
  return {
    ok: true,
    job: local !== undefined ? snapshot(local) : undefined,
    text: `archived ${archived.jobId} (${archived.title})`,
  };
}
