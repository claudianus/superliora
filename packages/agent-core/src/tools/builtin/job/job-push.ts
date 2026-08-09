/**
 * Push a finished Job worktree (or main checkout) ref to a remote.
 * Deterministic offload lane — never runs on worker Bash / Conductor Bash.
 * Force-push is always denied; interactive approve + force_user_confirm required.
 */

import type { Kaos } from '@superliora/kaos';

import { runGit as kaosRunGit } from '#/autopilot/git';

import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import type { JobRecord, JobStatus } from './job-ledger';
import { createJob, getJob, patchJob } from './job-ledger';
import { resolveJobWorktreeMergeRef } from './job-land';
import { patchJobAndNotify } from './job-notify';

export interface JobPushReceipt {
  readonly remote: string;
  readonly localRef: string;
  readonly remoteRef: string;
  readonly sha: string;
  readonly pushedAt: string;
}

export interface PushJobToRemoteInput {
  readonly store: ToolStore;
  readonly job: JobRecord;
  readonly remote: string;
  readonly localRef?: string;
  readonly remoteRef?: string;
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  readonly agent?: Agent;
  readonly runGit?: (
    cwd: string,
    args: readonly string[],
  ) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
}

export interface PushJobToRemoteResult {
  readonly ok: boolean;
  readonly job: JobRecord;
  readonly pushed: boolean;
  readonly receipt?: JobPushReceipt;
  readonly message: string;
  readonly error?: string;
}

async function defaultRunGit(
  kaos: Kaos | undefined,
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (kaos === undefined) {
    return { code: 1, stdout: '', stderr: 'kaos unavailable for git push' };
  }
  const res = await kaosRunGit(kaos, cwd, args);
  return {
    code: res.ok ? 0 : (res.exitCode ?? 1),
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

/** Reject force-push / option smuggling in remote or ref names. */
export function validatePushRefToken(value: string, label: string): string | undefined {
  const t = value.trim();
  if (t.length === 0) return `${label} required`;
  if (t.startsWith('-') || t.startsWith('+')) {
    return `${label} must not start with - or + (force/option smuggling denied)`;
  }
  if (/[\s\\:;|&$`]/.test(t)) return `${label} has invalid characters`;
  if (/\bforce\b/i.test(t) || t.includes('--')) {
    return `${label} must not request force-push`;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/.test(t) && !/^[0-9a-f]{7,40}$/i.test(t)) {
    return `${label} is not a safe git ref/remote token`;
  }
  return undefined;
}

export function evaluatePushTrust(input: {
  readonly approve: boolean;
  readonly forceUserConfirm: boolean;
  readonly remote: string;
  readonly localRef?: string;
  readonly remoteRef?: string;
}): { readonly ok: true; readonly reason: string } | { readonly ok: false; readonly reason: string } {
  if (!input.approve) {
    return { ok: false, reason: 'push rejected (approve=false)' };
  }
  if (!input.forceUserConfirm) {
    return {
      ok: false,
      reason:
        'Remote push requires explicit user confirmation (force_user_confirm=true via Push Preview). Auto/yolo never waives this.',
    };
  }
  const remoteErr = validatePushRefToken(input.remote, 'remote');
  if (remoteErr !== undefined) return { ok: false, reason: remoteErr };
  if (input.localRef !== undefined) {
    const err = validatePushRefToken(input.localRef, 'localRef');
    if (err !== undefined) return { ok: false, reason: err };
  }
  if (input.remoteRef !== undefined) {
    const err = validatePushRefToken(input.remoteRef, 'remoteRef');
    if (err !== undefined) return { ok: false, reason: err };
  }
  return { ok: true, reason: 'user-approved remote push' };
}

/**
 * Push source job HEAD (worktree preferred, else main repoPath) to remote.
 */
export async function pushJobToRemote(input: PushJobToRemoteInput): Promise<PushJobToRemoteResult> {
  const { store, job } = input;
  const remote = input.remote.trim() || 'origin';
  const remoteErr = validatePushRefToken(remote, 'remote');
  if (remoteErr !== undefined) {
    return { ok: false, job, pushed: false, message: '', error: remoteErr };
  }

  const cwd = job.worktreePath ?? input.repoPath;
  if (cwd === undefined || cwd.length === 0) {
    return {
      ok: false,
      job,
      pushed: false,
      message: '',
      error: 'worktreePath or repoPath required to push',
    };
  }

  const runGit =
    input.runGit ??
    ((dir: string, args: readonly string[]) => defaultRunGit(input.kaos, dir, args));

  let localRef = input.localRef?.trim();
  if (localRef === undefined || localRef.length === 0) {
    const resolved = await resolveJobWorktreeMergeRef(cwd, runGit, job.worktreeBranch);
    if (resolved.ref === undefined) {
      const detail = resolved.error ?? 'Could not resolve ref to push';
      const next = patchJobAndNotify(
        store,
        job.id,
        {
          status: 'blocked',
          notes: [job.notes, `push: ${detail}`].filter(Boolean).join('\n'),
        },
        { agent: input.agent, summary: detail },
      );
      return {
        ok: false,
        job: next ?? job,
        pushed: false,
        message: '',
        error: detail,
      };
    }
    localRef = resolved.ref;
  } else {
    const err = validatePushRefToken(localRef, 'localRef');
    if (err !== undefined) {
      return { ok: false, job, pushed: false, message: '', error: err };
    }
  }

  const remoteRef = (input.remoteRef?.trim() || localRef).trim();
  const remoteRefErr = validatePushRefToken(remoteRef, 'remoteRef');
  if (remoteRefErr !== undefined) {
    return { ok: false, job, pushed: false, message: '', error: remoteRefErr };
  }

  const shaRes = await runGit(cwd, ['rev-parse', localRef]);
  const sha = shaRes.code === 0 ? shaRes.stdout.trim() : '';
  if (sha.length === 0) {
    const detail = (shaRes.stderr || shaRes.stdout || 'rev-parse failed').slice(0, 500);
    const err = `could not resolve local ref ${localRef}: ${detail}`;
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'blocked',
        notes: [job.notes, `push: ${err}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: err },
    );
    return {
      ok: false,
      job: next ?? job,
      pushed: false,
      message: '',
      error: err,
    };
  }

  const refspec = `${localRef}:${remoteRef}`;
  const push = await runGit(cwd, ['push', remote, refspec]);
  if (push.code !== 0) {
    const detail = (push.stderr || push.stdout || 'push failed').slice(0, 500);
    const err = `git push failed: ${detail}`;
    const next = patchJobAndNotify(
      store,
      job.id,
      {
        status: 'blocked',
        notes: [job.notes, `push: failed — ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: err },
    );
    return {
      ok: false,
      job: next ?? job,
      pushed: false,
      message: '',
      error: err,
    };
  }

  const receipt: JobPushReceipt = {
    remote,
    localRef,
    remoteRef,
    sha,
    pushedAt: new Date().toISOString(),
  };
  const message = `Pushed ${localRef} → ${remote}/${remoteRef} (${sha.slice(0, 7)})`;
  const next = patchJobAndNotify(
    store,
    job.id,
    {
      status: 'done',
      resultSummary: message,
      notes: [
        job.notes,
        `push: ok remote=${remote} ${refspec} sha=${sha}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { agent: input.agent, summary: message },
  );

  return {
    ok: true,
    job: next ?? job,
    pushed: true,
    receipt,
    message,
  };
}

export interface DispatchPushRemoteInput {
  readonly store: ToolStore;
  readonly sourceJob: JobRecord;
  readonly trustReason: string;
  readonly remote: string;
  readonly localRef?: string;
  readonly remoteRef?: string;
  readonly summary?: string;
  readonly repoPath?: string;
  readonly kaos?: Kaos;
  readonly agent?: Agent;
  readonly runGit?: PushJobToRemoteInput['runGit'];
}

export interface DispatchPushRemoteResult {
  readonly dispatched: boolean;
  readonly pushJob?: JobRecord;
  readonly reason: string;
}

/**
 * Verdict/execution split (same shape as MergeJob land offload).
 * Interactive lane records approval; kind=push job runs git push detached.
 */
export function dispatchPushRemote(input: DispatchPushRemoteInput): DispatchPushRemoteResult {
  const { store, sourceJob, trustReason } = input;
  const remote = input.remote.trim() || 'origin';

  const verdictNote = `push: approved — ${trustReason}`;
  const source = patchJob(store, sourceJob.id, {
    resultSummary: input.summary ?? sourceJob.resultSummary,
    notes: [sourceJob.notes, verdictNote].filter(Boolean).join('\n'),
  });

  const pushJob = createJob(store, {
    title: `Push ${sourceJob.id} to ${remote}`,
    kind: 'push',
    priority: 10,
    prompt: [
      `Push approved work of ${sourceJob.id}.`,
      `remote: ${remote}`,
      `trust: ${trustReason}`,
      sourceJob.worktreePath ? `worktree: ${sourceJob.worktreePath}` : 'main checkout',
      input.localRef ? `localRef: ${input.localRef}` : undefined,
      input.remoteRef ? `remoteRef: ${input.remoteRef}` : undefined,
      input.repoPath ? `repo: ${input.repoPath}` : undefined,
      'Executor: pushJobToRemote on the offload lane (no force-push).',
    ]
      .filter(Boolean)
      .join('\n'),
    parentJobId: sourceJob.id,
  });
  const running = patchJob(store, pushJob.id, {
    status: 'running',
    notes: 'push-remote: dispatched (offload lane)',
  });

  void Promise.resolve().then(async () => {
    await runPushRemoteJob({
      store,
      pushJob: running ?? pushJob,
      kaos: input.kaos,
      repoPath: input.repoPath,
      runGit: input.runGit,
      agent: input.agent,
      sourceJob: source ?? sourceJob,
      remote,
      localRef: input.localRef,
      remoteRef: input.remoteRef,
    });
  });

  return {
    dispatched: true,
    pushJob: running ?? pushJob,
    reason: verdictNote,
  };
}

export interface RunPushRemoteJobInput {
  readonly store: ToolStore;
  readonly pushJob: JobRecord;
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  readonly runGit?: PushJobToRemoteInput['runGit'];
  readonly sourceJob?: JobRecord;
  readonly agent?: Agent;
  readonly remote: string;
  readonly localRef?: string;
  readonly remoteRef?: string;
}

/** Deterministic push executor for kind=push jobs — never spawns an LLM worker. */
export async function runPushRemoteJob(input: RunPushRemoteJobInput): Promise<PushJobToRemoteResult> {
  const { store, pushJob } = input;
  const source =
    input.sourceJob ??
    (pushJob.parentJobId !== undefined ? getJob(store, pushJob.parentJobId) : undefined);

  if (source === undefined) {
    const detail =
      pushJob.parentJobId === undefined
        ? 'push job missing parentJobId (source job)'
        : `source job not found: ${pushJob.parentJobId}`;
    const blocked = patchJobAndNotify(
      store,
      pushJob.id,
      {
        status: 'blocked',
        resultSummary: detail,
        notes: [pushJob.notes, `push-remote_failed: ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: detail },
    );
    return {
      ok: false,
      job: blocked ?? pushJob,
      pushed: false,
      message: '',
      error: detail,
    };
  }

  let result: PushJobToRemoteResult;
  try {
    result = await pushJobToRemote({
      store,
      job: source,
      remote: input.remote,
      localRef: input.localRef,
      remoteRef: input.remoteRef,
      kaos: input.kaos,
      repoPath: input.repoPath,
      runGit: input.runGit,
      agent: input.agent,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failed = patchJobAndNotify(
      store,
      pushJob.id,
      {
        status: 'failed',
        resultSummary: detail.slice(0, 2000),
        notes: [pushJob.notes, `push-remote_failed: ${detail}`].filter(Boolean).join('\n'),
      },
      { agent: input.agent, summary: detail.slice(0, 2000) },
    );
    return {
      ok: false,
      job: failed ?? pushJob,
      pushed: false,
      message: '',
      error: detail,
    };
  }

  const status: JobStatus = result.ok ? 'done' : 'blocked';
  const summary = result.ok ? result.message : (result.error ?? 'push failed');
  patchJobAndNotify(
    store,
    pushJob.id,
    {
      status,
      resultSummary: summary,
      notes: [
        pushJob.notes,
        result.ok
          ? `push-remote: ok — ${result.message}`
          : `push-remote_failed: ${result.error ?? 'unknown'}`,
        result.receipt !== undefined
          ? `receipt: ${result.receipt.remote} ${result.receipt.localRef}:${result.receipt.remoteRef} sha=${result.receipt.sha}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { agent: input.agent, summary },
  );
  return result;
}
