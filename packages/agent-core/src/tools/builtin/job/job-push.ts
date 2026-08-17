/**
 * Push a finished Job worktree (or main checkout) ref to a remote.
 * Deterministic offload lane — never runs on worker Bash / Conductor Bash.
 * Force-push is always denied; interactive approve + force_user_confirm required.
 *
 * Publish targeting: when remoteRef is omitted, infer from job brief/title
 * (e.g. `gh-pages` for Pages deploys) so conductor worktree branches push
 * as `liora/…:gh-pages` instead of a same-name remote branch.
 */

import type { Kaos } from '@superliora/kaos';

import { runGh as kaosRunGh, runGit as kaosRunGit } from '#/autopilot/git';
import { redactSecretsInText } from '#/security/redaction';

import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import type { JobRecord, JobStatus } from './job-ledger';
import { createJob, getJob, patchJob } from './job-ledger';
import { resolveMergePushCwd } from './job-git-root';
import { resolveJobWorktreeMergeRef } from './job-land';
import { patchJobAndNotify } from './job-notify';

export interface JobPushReceipt {
  readonly remote: string;
  readonly localRef: string;
  readonly remoteRef: string;
  readonly sha: string;
  readonly pushedAt: string;
  /** Set when GitHub Pages was enabled/updated after a gh-pages push. */
  readonly pagesEnabled?: boolean;
  readonly pagesNote?: string;
}

export type RunGitFn = (
  cwd: string,
  args: readonly string[],
) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;

export type RunGhFn = (
  args: readonly string[],
) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;

export interface PushJobToRemoteInput {
  readonly store: ToolStore;
  readonly job: JobRecord;
  readonly remote: string;
  readonly localRef?: string;
  readonly remoteRef?: string;
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  readonly agent?: Agent;
  readonly runGit?: RunGitFn;
  readonly runGh?: RunGhFn;
  /** Override Pages enable (default: true when remoteRef resolves to gh-pages). */
  readonly enablePages?: boolean;
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

async function defaultRunGh(
  kaos: Kaos | undefined,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (kaos === undefined) {
    return { code: 1, stdout: '', stderr: 'kaos unavailable for gh' };
  }
  const res = await kaosRunGh(kaos, args);
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

/** Keep git stderr on push failure notes, but never persist credentials. */
export function formatPushFailureDetail(raw: string, maxChars = 500): string {
  const redacted = redactSecretsInText(raw).text.replace(/\s+$/u, '');
  const trimmed = redacted.trim();
  if (trimmed.length === 0) return 'git produced no stderr';
  if (/^push failed$/i.test(trimmed)) return 'git push failed (no stderr)';
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

/**
 * Infer a publish remote ref from job brief / title / summary text.
 * Never auto-infers main/master — those need an explicit remote_ref.
 */
export function inferPublishRemoteRef(text: string): string | undefined {
  const blob = text.trim();
  if (blob.length === 0) return undefined;

  const structured =
    /\bremote[_ ]?ref\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob) ??
    /\bremoteRef\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob);
  if (structured?.[1] !== undefined) {
    const token = structured[1];
    if (validatePushRefToken(token, 'remoteRef') === undefined) return token;
  }

  // Pages deploy target (EN + common brief phrasing).
  if (/\bgh-pages\b/i.test(blob) || /\bgithub\s*pages\b/i.test(blob)) {
    return 'gh-pages';
  }
  return undefined;
}

/** Join job fields that commonly carry publish intent. */
export function collectJobPublishHints(job: JobRecord): string {
  return [job.title, job.prompt, job.resultSummary, job.notes, job.worktreeBranch]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n');
}

/**
 * Resolve remoteRef: explicit arg wins, else infer from job publish hints.
 */
export function resolvePushRemoteRef(input: {
  readonly explicit?: string;
  readonly job: JobRecord;
}): string | undefined {
  const explicit = input.explicit?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return inferPublishRemoteRef(collectJobPublishHints(input.job));
}

/** `owner/repo` from a github.com remote URL (https or ssh). */
export function parseGithubOwnerRepo(remoteUrl: string): { owner: string; repo: string } | undefined {
  const trimmed = remoteUrl.trim();
  const scp = /^[^@\s]+@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (scp?.[1] !== undefined && scp[2] !== undefined) {
    return { owner: scp[1], repo: scp[2].replace(/\.git$/i, '') };
  }
  try {
    const u = new URL(trimmed.replace(/^git\+/, ''));
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return undefined;
    const parts = u.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    /* not a URL */
  }
  return undefined;
}

/**
 * Best-effort: create or update GitHub Pages source to `branch` (usually gh-pages).
 * Push success is never rolled back if this fails.
 */
export async function enableGitHubPages(input: {
  readonly cwd: string;
  readonly remote: string;
  readonly branch: string;
  readonly runGit: RunGitFn;
  readonly runGh: RunGhFn;
}): Promise<{ readonly ok: boolean; readonly note: string }> {
  const urlRes = await input.runGit(input.cwd, ['remote', 'get-url', input.remote]);
  if (urlRes.code !== 0) {
    return { ok: false, note: `pages: skip — could not read remote URL (${input.remote})` };
  }
  const parsed = parseGithubOwnerRepo(urlRes.stdout.trim());
  if (parsed === undefined) {
    return { ok: false, note: 'pages: skip — remote is not github.com' };
  }
  const path = `/repos/${parsed.owner}/${parsed.repo}/pages`;
  // Create (POST). 409 / already-exists → update with PUT.
  const post = await input.runGh([
    'api',
    '-X',
    'POST',
    path,
    '-f',
    'build_type=legacy',
    '-f',
    `source[branch]=${input.branch}`,
    '-f',
    'source[path]=/',
  ]);
  if (post.code === 0) {
    return {
      ok: true,
      note: `pages: enabled source=${input.branch}/ → https://${parsed.owner}.github.io/${parsed.repo}/`,
    };
  }
  const detail = `${post.stderr} ${post.stdout}`.toLowerCase();
  const already =
    detail.includes('409') ||
    detail.includes('already exists') ||
    detail.includes('pages site already exists');
  if (!already) {
    return {
      ok: false,
      note: `pages: enable failed — ${(post.stderr || post.stdout || 'gh api error').slice(0, 240)}`,
    };
  }

  const put = await input.runGh([
    'api',
    '-X',
    'PUT',
    path,
    '-f',
    'build_type=legacy',
    '-f',
    `source[branch]=${input.branch}`,
    '-f',
    'source[path]=/',
  ]);
  if (put.code === 0) {
    return {
      ok: true,
      note: `pages: updated source=${input.branch}/ → https://${parsed.owner}.github.io/${parsed.repo}/`,
    };
  }
  return {
    ok: false,
    note: `pages: update failed — ${(put.stderr || put.stdout || 'gh api error').slice(0, 240)}`,
  };
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

  // Ownership product git root wins over session isolation / job worktree.
  // Pushing from metalslug isolation (no origin) failed job_mswkqsvg4bx2h4 —
  // superliora-owned Jobs must push from C:/Users/Administrator/superliora.
  const ownershipCwd = resolveMergePushCwd({
    ownershipPaths: job.ownershipPaths,
    worktreePath: job.worktreePath,
    sessionRepoPath: input.repoPath,
    mode: 'push',
  });
  if (ownershipCwd.hold?.hold === true) {
    const detail = ownershipCwd.hold.reason ?? 'cross_ownership_hold';
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

  const cwd =
    ownershipCwd.cwd ??
    job.worktreePath ??
    input.repoPath;
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

  // Resolve local ref from the job worktree when present; git push runs at ownership root.
  const refProbeCwd = job.worktreePath ?? cwd;

  let localRef = input.localRef?.trim();
  if (localRef === undefined || localRef.length === 0) {
    const resolved = await resolveJobWorktreeMergeRef(refProbeCwd, runGit, job.worktreeBranch);
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

  const inferredRemote = resolvePushRemoteRef({ explicit: input.remoteRef, job });
  const remoteRef = (inferredRemote ?? localRef).trim();
  const remoteRefErr = validatePushRefToken(remoteRef, 'remoteRef');
  if (remoteRefErr !== undefined) {
    return { ok: false, job, pushed: false, message: '', error: remoteRefErr };
  }

  const shaRes = await runGit(cwd, ['rev-parse', localRef]);
  const sha = shaRes.code === 0 ? shaRes.stdout.trim() : '';
  if (sha.length === 0) {
    const detail = formatPushFailureDetail(shaRes.stderr || shaRes.stdout || 'rev-parse failed');
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
    const detail = formatPushFailureDetail(push.stderr || push.stdout || 'push failed');
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

  let pagesEnabled: boolean | undefined;
  let pagesNote: string | undefined;
  const wantPages =
    input.enablePages === true ||
    (input.enablePages !== false && remoteRef === 'gh-pages');
  if (wantPages) {
    const runGh =
      input.runGh ?? ((args: readonly string[]) => defaultRunGh(input.kaos, args));
    const pages = await enableGitHubPages({
      cwd,
      remote,
      branch: remoteRef,
      runGit,
      runGh,
    });
    pagesEnabled = pages.ok;
    pagesNote = pages.note;
  }

  const receipt: JobPushReceipt = {
    remote,
    localRef,
    remoteRef,
    sha,
    pushedAt: new Date().toISOString(),
    ...(pagesEnabled !== undefined ? { pagesEnabled } : {}),
    ...(pagesNote !== undefined ? { pagesNote } : {}),
  };
  const message = [
    `Pushed ${localRef} → ${remote}/${remoteRef} (${sha.slice(0, 7)})`,
    pagesNote,
  ]
    .filter(Boolean)
    .join('\n');
  const next = patchJobAndNotify(
    store,
    job.id,
    {
      status: 'done',
      resultSummary: message,
      notes: [
        job.notes,
        `push: ok remote=${remote} ${refspec} sha=${sha}`,
        pagesNote,
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
  readonly runGh?: PushJobToRemoteInput['runGh'];
  readonly enablePages?: boolean;
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
  const remoteRef = resolvePushRemoteRef({
    explicit: input.remoteRef,
    job: {
      ...sourceJob,
      // Summary about to be written may carry gh-pages intent.
      resultSummary: input.summary ?? sourceJob.resultSummary,
    },
  });

  const verdictNote = [
    `push: approved — ${trustReason}`,
    remoteRef !== undefined ? `remoteRef=${remoteRef}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const source = patchJob(store, sourceJob.id, {
    resultSummary: input.summary ?? sourceJob.resultSummary,
    notes: [sourceJob.notes, verdictNote].filter(Boolean).join('\n'),
  });

  const pushTitle =
    remoteRef === 'gh-pages'
      ? `Push ${sourceJob.id} → ${remote}/gh-pages (Pages)`
      : `Push ${sourceJob.id} to ${remote}`;

  const pushJob = createJob(store, {
    title: pushTitle,
    kind: 'push',
    priority: 10,
    prompt: [
      `Push approved work of ${sourceJob.id}.`,
      `remote: ${remote}`,
      `trust: ${trustReason}`,
      sourceJob.worktreePath ? `worktree: ${sourceJob.worktreePath}` : 'main checkout',
      input.localRef ? `localRef: ${input.localRef}` : undefined,
      remoteRef ? `remoteRef: ${remoteRef}` : undefined,
      input.repoPath ? `repo: ${input.repoPath}` : undefined,
      'Executor: pushJobToRemote on the offload lane (no force-push).',
      remoteRef === 'gh-pages'
        ? 'After push: best-effort GitHub Pages enable (source=gh-pages/).'
        : undefined,
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
      runGh: input.runGh,
      agent: input.agent,
      sourceJob: source ?? sourceJob,
      remote,
      localRef: input.localRef,
      remoteRef,
      enablePages: input.enablePages,
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
  readonly runGh?: PushJobToRemoteInput['runGh'];
  readonly sourceJob?: JobRecord;
  readonly agent?: Agent;
  readonly remote: string;
  readonly localRef?: string;
  readonly remoteRef?: string;
  readonly enablePages?: boolean;
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

  // Prefer explicit / prompt-parsed ref; else infer from push job + source hints
  // (CreateJob kind=push titles like "… gh-pages … Pages …" land here).
  const remoteRef =
    resolvePushRemoteRef({ explicit: input.remoteRef, job: pushJob }) ??
    resolvePushRemoteRef({ job: source });

  let result: PushJobToRemoteResult;
  try {
    result = await pushJobToRemote({
      store,
      job: source,
      remote: input.remote,
      localRef: input.localRef,
      remoteRef,
      kaos: input.kaos,
      repoPath: input.repoPath,
      runGit: input.runGit,
      runGh: input.runGh,
      enablePages: input.enablePages,
      agent: input.agent,
    });
  } catch (error) {
    const detail = formatPushFailureDetail(error instanceof Error ? error.message : String(error));
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
