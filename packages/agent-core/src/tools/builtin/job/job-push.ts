/**
 * Push a finished Job worktree (or main checkout) ref to a remote.
 * Deterministic offload lane — never runs on worker Bash / Conductor Bash.
 * Force-push is always denied; interactive approve + force_user_confirm required.
 *
 * Publish targeting: explicit remote_ref, a structured remote_ref: field,
 * or an LLM publish-effect judgment. Never inferred from title keywords.
 * Never auto-infers main/master.
 */

import type { Kaos } from '@superliora/kaos';

import { join } from 'node:path';

import { runGh as kaosRunGh, runGit as kaosRunGit } from '#/autopilot/git';
import { redactSecretsInText } from '#/security/redaction';

import { createUserMessage } from '@superliora/kosong';

import type { Agent } from '../../../agent/index';
import {
  clampConfidence,
  clipClassifierText,
  createClassifierTimeoutSignal,
  extractTextFromGenerateResponse,
  parseJsonResponse,
  classifierDepsFromAgent,
  type LlmClassifierDeps,
} from '../../../utils/llm-classifier-utils';
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
 * Structured `remote_ref:` / `remoteRef:` field only.
 * Never auto-infers main/master — those need an explicit remote_ref.
 * Never classifies from title keywords.
 */
export function inferPublishRemoteRef(text: string): string | undefined {
  const blob = text.trim();
  if (blob.length === 0) return undefined;

  const structured =
    /\bremote[_ ]?ref\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob) ??
    /\bremoteRef\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob);
  if (structured?.[1] !== undefined) {
    const token = structured[1];
    if (isForbiddenAutoRemoteRef(token)) return undefined;
    if (validatePushRefToken(token, 'remoteRef') === undefined) return token;
  }
  return undefined;
}

const PUSH_REMOTE_CONFIDENCE_FLOOR = 0.55;

const PUBLISH_TARGET_SYSTEM = [
  'You judge the intended git publish target of a finished job. Return ONLY compact JSON:',
  '{"pages_publish":true,"remote_ref":"gh-pages","confidence":0.9,"rationale":"one sentence about the publish effect"}',
  '',
  'Decide the remote branch the work should land on — not what words appear in the title.',
  '',
  'Definitions:',
  '- pages_publish: the finish line is publishing a static site to a GitHub Pages (or equivalent host) branch.',
  '- remote_ref: the remote branch name when pages_publish is true. Never main or master.',
  '',
  'Rules:',
  '- Reason from the done-contract and publish effect first. Title and brief are context only.',
  '- Do not classify by matching words or phrases in any language.',
  '- Ordinary product-branch publish (same as the local ref) → pages_publish=false and omit remote_ref.',
  '- Ambiguous or low confidence → pages_publish=false and omit remote_ref.',
  '- rationale names the publish effect, never quoted trigger words.',
].join('\n');

export interface PublishTargetJudgment {
  readonly pagesPublish: boolean;
  readonly remoteRef?: string;
  readonly confidence: number;
  readonly rationale: string;
}

export function parsePublishTargetJudgment(text: string): PublishTargetJudgment | undefined {
  const record = parseJsonResponse(text);
  if (record === undefined) return undefined;
  const pagesPublish = record['pages_publish'];
  if (typeof pagesPublish !== 'boolean') return undefined;
  const confidence = clampConfidence(record['confidence']);
  if (confidence === undefined) return undefined;
  const rationaleRaw = record['rationale'];
  const rationale =
    typeof rationaleRaw === 'string' && rationaleRaw.trim().length > 0
      ? rationaleRaw.trim()
      : 'publish judgment';
  const remoteRaw = record['remote_ref'];
  const remoteRef =
    typeof remoteRaw === 'string' && remoteRaw.trim().length > 0 ? remoteRaw.trim() : undefined;
  return { pagesPublish, remoteRef, confidence, rationale };
}

export function remoteRefFromPublishJudgment(
  judgment: PublishTargetJudgment,
): string | undefined {
  if (judgment.confidence < PUSH_REMOTE_CONFIDENCE_FLOOR) return undefined;
  if (!judgment.pagesPublish) return undefined;
  const token = judgment.remoteRef;
  if (token === undefined || isForbiddenAutoRemoteRef(token)) return undefined;
  if (validatePushRefToken(token, 'remoteRef') !== undefined) return undefined;
  return token;
}

function isForbiddenAutoRemoteRef(token: string): boolean {
  return /^(main|master)$/i.test(token.trim());
}

async function inferPublishRemoteRefFromEffect(
  deps: LlmClassifierDeps,
  job: JobRecord,
  options?: { readonly signal?: AbortSignal },
): Promise<string | undefined> {
  const user = [
    'Judge the intended remote publish target. Title/brief are context, not a keyword checklist.',
    '',
    `title: ${clipClassifierText(job.title)}`,
    job.prompt !== undefined ? `brief: ${clipClassifierText(job.prompt)}` : undefined,
    job.resultSummary !== undefined
      ? `result_summary: ${clipClassifierText(job.resultSummary)}`
      : undefined,
    (job.successCriteria ?? []).length > 0
      ? `success_criteria:\n${job.successCriteria!.map((line) => `- ${clipClassifierText(line, 400)}`).join('\n')}`
      : undefined,
    (job.verificationCommands ?? []).length > 0
      ? `verification_commands:\n${job.verificationCommands!.map((line) => `- ${clipClassifierText(line, 400)}`).join('\n')}`
      : undefined,
    job.notes !== undefined ? `notes: ${clipClassifierText(job.notes)}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  if (user.trim().length === 0) return undefined;
  try {
    const response = await deps.generate(
      deps.provider,
      PUBLISH_TARGET_SYSTEM,
      [],
      [createUserMessage(user)],
      undefined,
      { signal: createClassifierTimeoutSignal(10_000, options?.signal) },
    );
    const parsed = parsePublishTargetJudgment(extractTextFromGenerateResponse(response));
    if (parsed === undefined) return undefined;
    return remoteRefFromPublishJudgment(parsed);
  } catch {
    return undefined;
  }
}

/** Join job fields that commonly carry publish intent. */
export function collectJobPublishHints(job: JobRecord): string {
  return [job.title, job.prompt, job.resultSummary, job.notes, job.worktreeBranch]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n');
}

/**
 * Resolve remoteRef: explicit arg wins, else a structured remote_ref: field.
 * Keyword matching is forbidden — use {@link resolvePushRemoteRefWithInfer}.
 */
export function resolvePushRemoteRef(input: {
  readonly explicit?: string;
  readonly job: JobRecord;
}): string | undefined {
  const explicit = input.explicit?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return inferPublishRemoteRef(collectJobPublishHints(input.job));
}

/** Explicit / structured field, then LLM publish-effect judgment. Never infers main. */
export async function resolvePushRemoteRefWithInfer(input: {
  readonly explicit?: string;
  readonly job: JobRecord;
  readonly deps?: LlmClassifierDeps;
  readonly signal?: AbortSignal;
}): Promise<string | undefined> {
  const structured = resolvePushRemoteRef(input);
  if (structured !== undefined) return structured;
  if (input.deps === undefined) return undefined;
  return inferPublishRemoteRefFromEffect(input.deps, input.job, { signal: input.signal });
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

  // Job product root wins over session isolation / job worktree.
  const ownershipCwd = resolveMergePushCwd({
    persistedRepoRoot: job.repoRoot,
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

  const inferredRemote = await resolvePushRemoteRefWithInfer({
    explicit: input.remoteRef,
    job,
    deps: classifierDepsFromAgent(input.agent),
  });
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
  /** Batch publish (multi-repo). Presence switches the push job to batch mode. */
  readonly targets?: readonly JobPushTarget[];
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
    input.targets !== undefined && input.targets.length > 0
      ? `Push ${sourceJob.id} → ${input.targets.length} repo(s) (batch)`
      : remoteRef === 'gh-pages'
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
      (sourceJob.repoRoot ?? input.repoPath) ? `repo: ${sourceJob.repoRoot ?? input.repoPath}` : undefined,
      input.targets !== undefined && input.targets.length > 0
        ? `targets:\n${JSON.stringify(input.targets, null, 2)}`
        : undefined,
      'Executor: pushJobToRemote on the offload lane (no force-push).',
      input.targets !== undefined && input.targets.length > 0
        ? 'Executor: runMultiRepoPush batch (create_if_missing repos via gh; no force-push).'
        : 'Executor: pushJobToRemote on the offload lane (no force-push).',
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
      repoPath: sourceJob.repoRoot ?? input.repoPath,
      runGit: input.runGit,
      runGh: input.runGh,
      agent: input.agent,
      sourceJob: source ?? sourceJob,
      remote,
      localRef: input.localRef,
      remoteRef,
      enablePages: input.enablePages,
      targets: input.targets,
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
  /** Batch publish (multi-repo): one entry per repo, executed in order. */
  readonly targets?: readonly JobPushTarget[];
}

/**
 * One batch-publish unit. `repo` is a GitHub `"name"` (auth user) or
 * `"owner/name"`; `source_dir` points at the git repo inside the job
 * worktree when a job produced several projects. Creation and push are
 * user-gated upstream (PushJob force_user_confirm) — the executor never
 * re-prompts and never force-pushes.
 */
interface JobPushTarget {
  readonly repo: string;
  readonly source_dir?: string;
  readonly branch?: string;
  readonly create_if_missing?: boolean;
  readonly private_repo?: boolean;
  readonly pages?: boolean;
}

export function validatePushTargetRepo(repo: string): string | undefined {
  const t = repo.trim();
  if (t.length === 0) return 'repo required';
  if (t.includes('/')) {
    const parts = t.split('/');
    if (parts.length !== 2) return 'repo must be "name" or "owner/name"';
    const [owner, name] = parts;
    const okToken = (s: string | undefined): boolean =>
      s !== undefined && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s);
    if (!okToken(owner) || !okToken(name)) {
      return 'owner and name must be alnum/._- tokens';
    }
    return undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t)) {
    return 'repo must be a GitHub "name" or "owner/name" (no URL, no spaces)';
  }
  return undefined;
}

/**
 * A batch target's `source_dir` must stay inside the job worktree: `join()`
 * accepts absolute paths and `..` segments, so one unvalidated target could
 * point the push machinery (gh repo create, git push) at any directory on
 * disk — and in batch mode a single Push Preview approval covers the whole
 * list. Enforce a plain relative worktree path: no drive letter, no UNC, no
 * leading separator, no `.`/`..` segments, path-safe charset.
 */
export function validatePushTargetSourceDir(dir: string): string | undefined {
  const t = dir.trim();
  if (t.length === 0) return 'source_dir must not be empty';
  if (t.length > 512) return 'source_dir too long';
  if (/^[a-zA-Z]:/.test(t)) return 'source_dir must be relative to the job worktree (no drive letter)';
  if (t.startsWith('/') || t.startsWith('\\')) {
    return 'source_dir must be relative to the job worktree (no absolute or UNC path)';
  }
  const segments = t.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      return 'source_dir must stay inside the job worktree (no "." or ".." segments)';
    }
    if (segment.length === 0) return 'source_dir must not contain empty path segments';
    if (!/^[A-Za-z0-9._ -]+$/.test(segment)) {
      return 'source_dir segments must use letters, digits, dot, dash, underscore, space';
    }
  }
  return undefined;
}

interface MultiRepoPushTargetResult {
  readonly repo: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly created?: boolean;
  readonly url?: string;
}

/**
 * Batch-publish executor: one GitHub repo per target, each pushed from its
 * own git repo (a subdirectory of the job worktree for multi-project jobs).
 * Missing repos are created via `gh` (user-gated upstream), the origin remote
 * is added when missing, and `git push -u` lands the branch. No force-push;
 * per-target failures do not stop later targets.
 */
export async function runMultiRepoPush(input: {
  readonly pushJob: JobRecord;
  readonly sourceJob: JobRecord;
  readonly targets: readonly JobPushTarget[];
  readonly kaos?: Kaos;
  readonly repoPath?: string;
  readonly runGit?: RunGitFn;
  readonly runGh?: RunGhFn;
}): Promise<{
  readonly ok: boolean;
  readonly summary: string;
  readonly results: readonly MultiRepoPushTargetResult[];
}> {
  const runGit =
    input.runGit ?? ((dir: string, args: readonly string[]) => defaultRunGit(input.kaos, dir, args));
  const runGh = input.runGh ?? ((args: readonly string[]) => defaultRunGh(input.kaos, args));
  const base = input.sourceJob.worktreePath ?? input.repoPath;
  const results: MultiRepoPushTargetResult[] = [];

  if (base === undefined || base.length === 0) {
    return {
      ok: false,
      summary: 'multi-repo push: worktreePath or repoPath required',
      results: [],
    };
  }

  for (const target of input.targets) {
    const repo = target.repo.trim();
    const repoErr = validatePushTargetRepo(repo);
    if (repoErr !== undefined) {
      results.push({ repo, ok: false, detail: repoErr });
      continue;
    }
    let cwd = base;
    if (target.source_dir !== undefined) {
      // Defense in depth: the tool schema validates each target, but the
      // executor must never join an untrusted path even when called from
      // the offload lane directly.
      const dirErr = validatePushTargetSourceDir(target.source_dir);
      if (dirErr !== undefined) {
        results.push({ repo, ok: false, detail: dirErr });
        continue;
      }
      cwd = join(base, target.source_dir);
    }

    const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0 || !inside.stdout.trim().includes('true')) {
      results.push({
        repo,
        ok: false,
        detail: `${cwd} is not a git repository (run git init in the project first)`,
      });
      continue;
    }

    let branchName: string;
    const explicitBranch = target.branch?.trim();
    if (explicitBranch !== undefined && explicitBranch.length > 0) {
      branchName = explicitBranch;
    } else {
      const head = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const headName = head.code === 0 ? head.stdout.trim() : '';
      if (headName.length === 0 || headName === 'HEAD') {
        results.push({
          repo,
          ok: false,
          detail: 'detached HEAD — pass an explicit branch to push',
        });
        continue;
      }
      branchName = headName;
    }
    const branchErr = validatePushRefToken(branchName, 'branch');
    if (branchErr !== undefined) {
      results.push({ repo, ok: false, detail: branchErr });
      continue;
    }

    const view = await runGh(['repo', 'view', repo, '--json', 'url']);
    let url: string | undefined;
    let created = false;
    if (view.code === 0) {
      try {
        url = (JSON.parse(view.stdout) as { url?: string }).url;
      } catch {
        url = undefined;
      }
    } else if (target.create_if_missing === false) {
      results.push({ repo, ok: false, detail: 'repo missing and create_if_missing=false' });
      continue;
    } else {
      const detail = `${view.stderr} ${view.stdout}`.toLowerCase();
      const authIssue =
        detail.includes('gh auth') || detail.includes('authentication') || detail.includes('login');
      if (authIssue) {
        results.push({ repo, ok: false, detail: 'gh not authenticated — run gh auth login' });
        continue;
      }
      const createArgs = ['repo', 'create'];
      if (repo.includes('/')) {
        const [owner, name] = repo.split('/');
        createArgs.push(name!, '--owner', owner!);
      } else {
        createArgs.push(repo);
      }
      createArgs.push(target.private_repo === true ? '--private' : '--public');
      const createdRes = await runGh(createArgs);
      if (createdRes.code !== 0) {
        const detail = formatPushFailureDetail(
          createdRes.stderr || createdRes.stdout || 'gh repo create failed',
        );
        results.push({ repo, ok: false, detail: `create failed: ${detail}` });
        continue;
      }
      created = true;
      const urlRes = await runGh(['repo', 'view', repo, '--json', 'url']);
      try {
        url = (JSON.parse(urlRes.stdout) as { url?: string }).url;
      } catch {
        url = undefined;
      }
      if (url === undefined || url.length === 0) {
        results.push({
          repo,
          ok: false,
          detail: 'repo created but the remote URL could not be resolved via gh',
        });
        continue;
      }
    }

    if (url === undefined || url.length === 0) {
      results.push({ repo, ok: false, detail: 'could not resolve the repo remote URL' });
      continue;
    }

    const remoteCheck = await runGit(cwd, ['remote', 'get-url', 'origin']);
    if (remoteCheck.code !== 0) {
      const add = await runGit(cwd, ['remote', 'add', 'origin', url]);
      if (add.code !== 0) {
        results.push({
          repo,
          ok: false,
          detail: `remote add failed: ${formatPushFailureDetail(add.stderr || add.stdout)}`,
        });
        continue;
      }
    }

    const push = await runGit(cwd, ['push', '-u', 'origin', branchName]);
    if (push.code !== 0) {
      results.push({
        repo,
        ok: false,
        detail: `push failed: ${formatPushFailureDetail(push.stderr || push.stdout)}`,
      });
      continue;
    }

    let detail = `pushed ${branchName} → ${repo}`;
    if (target.pages === true) {
      const pages = await enableGitHubPages({
        cwd,
        remote: 'origin',
        branch: branchName,
        runGit,
        runGh,
      });
      detail = `${detail}; ${pages.note}`;
    }

    results.push({
      repo,
      ok: true,
      created,
      url,
      detail,
    });
  }

  const okCount = results.filter((r) => r.ok).length;
  const allOk = okCount === results.length && results.length > 0;
  const summary = [
    `multi-repo push: ${okCount}/${results.length} ok`,
    ...results.map((r) => `- ${r.repo}: ${r.ok ? 'ok' : 'failed'} — ${r.detail}`),
  ].join('\n');
  return { ok: allOk, summary, results };
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

  // Prefer explicit / structured remote_ref. Title wording is not a signal;
  // pushJobToRemote may still effect-judge when remoteRef is omitted.
  const remoteRef =
    resolvePushRemoteRef({ explicit: input.remoteRef, job: pushJob }) ??
    resolvePushRemoteRef({ job: source });

  // Batch publish (multi-repo): each target is its own repo + push.
  if (input.targets !== undefined && input.targets.length > 0) {
    const batch = await runMultiRepoPush({
      pushJob,
      sourceJob: source,
      targets: input.targets,
      kaos: input.kaos,
      repoPath: source.repoRoot ?? input.repoPath,
      runGit: input.runGit,
      runGh: input.runGh,
    });
    const status: JobStatus = batch.ok ? 'done' : 'failed';
    patchJobAndNotify(
      store,
      pushJob.id,
      {
        status,
        resultSummary: batch.summary.slice(0, 4000),
        notes: [
          pushJob.notes,
          batch.ok
            ? `push-remote: batch ok — ${batch.summary.split('\n')[0] ?? ''}`
            : `push-remote_failed: batch — ${batch.summary.split('\n')[0] ?? ''}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
      { agent: input.agent, summary: batch.summary.split('\n')[0] ?? batch.summary },
    );
    return {
      ok: batch.ok,
      job: pushJob,
      pushed: batch.ok,
      message: batch.summary,
      error: batch.ok ? undefined : batch.summary,
    };
  }

  let result: PushJobToRemoteResult;
  try {
    result = await pushJobToRemote({
      store,
      job: source,
      remote: input.remote,
      localRef: input.localRef,
      remoteRef,
      kaos: input.kaos,
      repoPath: source.repoRoot ?? input.repoPath,
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
