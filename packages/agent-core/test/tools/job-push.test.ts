import { describe, expect, it, vi } from 'vitest';

import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import {
  diagnoseAuthFailure,
  dispatchPushRemote,
  evaluatePushTrust,
  inferPublishRemoteRef,
  looksLikeAuthFailure,
  parseGithubOwnerRepo,
  parsePublishTargetJudgment,
  pushJobToRemote,
  remoteRefFromPublishJudgment,
  runMultiRepoPush,
  validatePushRefToken,
  validatePushTargetRepo,
  validatePushTargetSourceDir,
} from '../../src/tools/builtin/job/job-push';
import { PushJobTool } from '../../src/tools/builtin/job/job-tools';
import { guardWorkerShellCommand } from '../../src/tools/builtin/job/job-worker-guards';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return {
    get: (key) => data.get(key) as never,
    set: (key, value) => {
      data.set(key, value);
    },
  } as ToolStore;
}

describe('job-push trust + refs', () => {
  it('rejects force / option smuggling in ref tokens', () => {
    expect(validatePushRefToken('--force', 'remote')).toBeDefined();
    expect(validatePushRefToken('+main', 'localRef')).toBeDefined();
    expect(validatePushRefToken('origin', 'remote')).toBeUndefined();
    expect(validatePushRefToken('gh-pages', 'remoteRef')).toBeUndefined();
  });

  it('requires force_user_confirm for approve', () => {
    expect(
      evaluatePushTrust({
        approve: true,
        forceUserConfirm: false,
        remote: 'origin',
      }).ok,
    ).toBe(false);
    expect(
      evaluatePushTrust({
        approve: true,
        forceUserConfirm: true,
        remote: 'origin',
        localRef: 'main',
      }).ok,
    ).toBe(true);
  });

  it('keeps worker Bash push ban', () => {
    expect(guardWorkerShellCommand('git push origin HEAD', { isWorker: true }).allowed).toBe(
      false,
    );
  });

  it('reads a structured remote_ref field and never infers from wording or main', () => {
    expect(
      inferPublishRemoteRef('Push: origin/main + gh-pages 배포 및 Pages 활성화'),
    ).toBeUndefined();
    expect(inferPublishRemoteRef('remoteRef: docs-site')).toBe('docs-site');
    expect(inferPublishRemoteRef('remote_ref: gh-pages')).toBe('gh-pages');
    expect(inferPublishRemoteRef('remote_ref: main')).toBeUndefined();
    expect(inferPublishRemoteRef('ship to origin/main only')).toBeUndefined();
    expect(parseGithubOwnerRepo('https://github.com/claudianus/metalslug1.git')).toEqual({
      owner: 'claudianus',
      repo: 'metalslug1',
    });
    expect(parseGithubOwnerRepo('git@github.com:acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('maps a confident pages-publish judgment and refuses main', () => {
    const pages = parsePublishTargetJudgment(
      '{"pages_publish":true,"remote_ref":"gh-pages","confidence":0.9,"rationale":"static site host branch"}',
    );
    expect(pages).toBeDefined();
    expect(remoteRefFromPublishJudgment(pages!)).toBe('gh-pages');
    const main = parsePublishTargetJudgment(
      '{"pages_publish":true,"remote_ref":"main","confidence":0.9,"rationale":"default branch"}',
    );
    expect(remoteRefFromPublishJudgment(main!)).toBeUndefined();
    const skip = parsePublishTargetJudgment(
      '{"pages_publish":false,"confidence":0.8,"rationale":"same as local ref"}',
    );
    expect(remoteRefFromPublishJudgment(skip!)).toBeUndefined();
  });
});

describe('push auth diagnosis', () => {
  it('recognizes credential-style git/gh failures', () => {
    expect(looksLikeAuthFailure('fatal: Authentication failed for https://github.com/o/r')).toBe(true);
    expect(looksLikeAuthFailure('git: "terminal prompts disabled"')).toBe(true);
    expect(looksLikeAuthFailure('Permission denied (publickey).')).toBe(true);
    expect(looksLikeAuthFailure('gh not authenticated')).toBe(true);
    expect(looksLikeAuthFailure('everything up-to-date')).toBe(false);
  });

  it('passes non-auth failures through untouched', async () => {
    const detail = await diagnoseAuthFailure({
      detail: 'non-fast-forward: fetch first',
      runGh: vi.fn(),
    });
    expect(detail).toBe('non-fast-forward: fetch first');
  });

  it('enriches auth failures with a gh logged-in probe result', async () => {
    const runGh = vi.fn(async () => ({ code: 0, stdout: 'octocat\n', stderr: '' }));
    const detail = await diagnoseAuthFailure({
      detail: 'fatal: Authentication failed for https://github.com/o/r',
      runGh,
    });
    expect(detail).toContain('octocat');
    expect(detail).toContain('repo scope');
  });

  it('adds the login fix when the gh probe confirms logged_out', async () => {
    const runGh = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'gh: To get started with GitHub CLI, run gh auth login',
    }));
    const detail = await diagnoseAuthFailure({
      detail: 'fatal: could not read Username for https://github.com',
      runGh,
    });
    expect(detail).toContain('gh auth login');
  });

  it('records the gh login guidance in blocked push notes', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'ship site', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt',
      worktreeBranch: 'deploy-me',
    });
    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { code: 0, stdout: 'deploy-me\n', stderr: '' };
      }
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'abcdef0123456789\n', stderr: '' };
      }
      if (args[0] === 'push') {
        return {
          code: 128,
          stdout: '',
          stderr: "fatal: Authentication failed for 'https://github.com/o/r.git/'\n",
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const runGh = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'gh: To log in, run: gh auth login',
    }));

    const result = await pushJobToRemote({
      store,
      job: getJob(store, job.id)!,
      remote: 'origin',
      localRef: 'deploy-me',
      runGit,
      runGh,
      enablePages: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('gh auth login');
    expect(getJob(store, job.id)?.status).toBe('blocked');
    expect(getJob(store, job.id)?.notes).toContain('gh auth login');
  });
});

describe('pushJobToRemote', () => {
  it('runs git push via injectable runner and records receipt', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'publish pages', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt',
      worktreeBranch: 'gh-pages',
    });

    const calls: string[][] = [];
    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { code: 0, stdout: 'gh-pages\n', stderr: '' };
      }
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'abcdef0123456789\n', stderr: '' };
      }
      if (args[0] === 'push') {
        return { code: 0, stdout: 'ok\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const result = await pushJobToRemote({
      store,
      job: getJob(store, job.id)!,
      remote: 'origin',
      localRef: 'gh-pages',
      remoteRef: 'gh-pages',
      runGit,
      enablePages: false,
    });

    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.receipt?.sha).toBe('abcdef0123456789');
    expect(
      calls.some((c) => c[0] === 'push' && c[1] === 'origin' && c[2] === 'gh-pages:gh-pages'),
    ).toBe(true);
    expect(getJob(store, job.id)?.resultSummary).toMatch(/Pushed/);
  });

  it('does not invent gh-pages from title wording when remoteRef is omitted', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Push: origin/main + gh-pages 배포 및 Pages 활성화',
      kind: 'implement',
    });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt',
      worktreeBranch: 'liora/conductor-jmsl8pcld1vb3s8',
    });

    const gitCalls: string[][] = [];
    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      gitCalls.push([...args]);
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: '6557a3dabcdef0123456789\n', stderr: '' };
      }
      if (args[0] === 'push') {
        return { code: 0, stdout: 'ok\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const result = await pushJobToRemote({
      store,
      job: getJob(store, job.id)!,
      remote: 'origin',
      localRef: 'liora/conductor-jmsl8pcld1vb3s8',
      runGit,
    });

    expect(result.ok).toBe(true);
    expect(result.receipt?.remoteRef).toBe('liora/conductor-jmsl8pcld1vb3s8');
    expect(result.receipt?.pagesEnabled).toBeFalsy();
    expect(
      gitCalls.some(
        (c) =>
          c[0] === 'push' &&
          c[1] === 'origin' &&
          c[2] === 'liora/conductor-jmsl8pcld1vb3s8:liora/conductor-jmsl8pcld1vb3s8',
      ),
    ).toBe(true);
  });

  it('uses a publish-effect judgment when the classifier returns a Pages branch', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Ship the static site',
      kind: 'implement',
      successCriteria: ['static site is live on the host branch'],
    });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt',
      worktreeBranch: 'liora/conductor-jmsl8pcld1vb3s8',
    });

    const gitCalls: string[][] = [];
    const ghCalls: string[][] = [];
    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      gitCalls.push([...args]);
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: '6557a3dabcdef0123456789\n', stderr: '' };
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { code: 0, stdout: 'https://github.com/claudianus/metalslug1.git\n', stderr: '' };
      }
      if (args[0] === 'push') {
        return { code: 0, stdout: 'ok\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const runGh = vi.fn(async (args: readonly string[]) => {
      ghCalls.push([...args]);
      return { code: 0, stdout: '{"status":"built"}\n', stderr: '' };
    });
    const agent = {
      generate: async () => ({
        message: {
          content: [
            {
              type: 'text',
              text: '{"pages_publish":true,"remote_ref":"gh-pages","confidence":0.9,"rationale":"static host branch"}',
            },
          ],
        },
      }),
      config: { hasProvider: true, provider: {} },
    };

    const result = await pushJobToRemote({
      store,
      job: getJob(store, job.id)!,
      remote: 'origin',
      localRef: 'liora/conductor-jmsl8pcld1vb3s8',
      runGit,
      runGh,
      agent: agent as never,
    });

    expect(result.ok).toBe(true);
    expect(result.receipt?.remoteRef).toBe('gh-pages');
    expect(result.receipt?.pagesEnabled).toBe(true);
    expect(
      gitCalls.some(
        (c) =>
          c[0] === 'push' &&
          c[1] === 'origin' &&
          c[2] === 'liora/conductor-jmsl8pcld1vb3s8:gh-pages',
      ),
    ).toBe(true);
    expect(ghCalls.some((c) => c.includes('/repos/claudianus/metalslug1/pages'))).toBe(true);
    expect(result.message).toMatch(/pages: enabled/i);
  });

  it('records git stderr on push failure and masks credentials', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'publish pages', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt',
      worktreeBranch: 'gh-pages',
    });

    // Assemble at runtime so GH013 push protection does not treat fixtures as live secrets.
    const fakePat = 'ghp' + '_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
    const fakeSlack = 'xoxb' + '-' + '123456789012-abcdefghijklmnop';
    const fakeJwtPrefix = 'eyJhbGciOiJIUzI1NiJ9';

    const runGit = vi.fn(async (_cwd: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'abcdef0123456789\n', stderr: '' };
      }
      if (args[0] === 'push') {
        return {
          code: 1,
          stdout: '',
          stderr: [
            `remote: Invalid username or token: ${fakePat}`,
            "fatal: Authentication failed for 'https://user:supersecret@github.com/acme/repo.git'",
            `Authorization: Bearer ${fakeJwtPrefix}.payload`,
            fakeSlack,
          ].join('\n'),
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const result = await pushJobToRemote({
      store,
      job: getJob(store, job.id)!,
      remote: 'origin',
      localRef: 'gh-pages',
      remoteRef: 'gh-pages',
      runGit,
      enablePages: false,
    });

    expect(result.ok).toBe(false);
    const notes = getJob(store, job.id)?.notes ?? '';
    const error = result.error ?? '';
    expect(notes).toMatch(/Authentication failed|Invalid username or token/);
    expect(notes).not.toMatch(/^push failed$/im);
    expect(error).not.toMatch(/^push failed$/i);
    expect(notes).not.toContain(fakePat);
    expect(notes).not.toContain('supersecret');
    expect(notes).not.toContain(fakeJwtPrefix);
    expect(notes).not.toContain(fakeSlack);
    expect(error).not.toContain(fakePat);
    expect(error).not.toContain('supersecret');
    expect(error).not.toContain(fakeSlack);
  });
});

describe('PushJobTool + dispatch', () => {
  it('holds without force_user_confirm', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'ship', kind: 'implement' });
    const tool = new PushJobTool(store);
    const exec = tool.resolveExecution({
      job_id: job.id,
      approve: true,
      force_user_confirm: false,
    });
    if (exec.isError) throw new Error('resolve failed');
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(out.isError).toBe(true);
    expect(String(out.output)).toMatch(/Push held|force_user_confirm/i);
  });

  it('rejects an escaping source_dir target before dispatching any push', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'ship', kind: 'implement' });
    patchJob(store, job.id, { worktreePath: '/tmp/wt' });
    const tool = new PushJobTool(store);
    const exec = tool.resolveExecution({
      job_id: job.id,
      approve: true,
      force_user_confirm: true,
      targets: [{ repo: 'owner/x', source_dir: '../../etc' }],
    });
    if (exec.isError) throw new Error('resolve failed');
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(out.isError).toBe(true);
    expect(String(out.output)).toMatch(/source_dir must stay inside the job worktree/);
    // No kind=push job was created — the bad target aborted the dispatch.
    expect(listJobs(store).some((j) => j.kind === 'push')).toBe(false);
  });

  it('dispatches kind=push offload on user approve', async () => {
    const store = memoryStore();
    const source = createJob(store, { title: 'ship', kind: 'implement' });
    const runGit = vi.fn(async () => ({ code: 0, stdout: 'abcdef0\n', stderr: '' }));
    const dispatch = dispatchPushRemote({
      store,
      sourceJob: getJob(store, source.id)!,
      trustReason: 'user-approved remote push',
      remote: 'origin',
      localRef: 'main',
      remoteRef: 'main',
      runGit,
    });
    expect(dispatch.dispatched).toBe(true);
    expect(dispatch.pushJob?.kind).toBe('push');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(listJobs(store).some((j) => j.kind === 'push')).toBe(true);
  });
});

describe('multi-repo batch push', () => {
  function gitRepoRunner(opts?: { readonly repoExists?: boolean }) {
    const remotes = new Map<string, string>();
    return {
      remotes,
      runGit: vi.fn(async (_cwd: string, args: readonly string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
          return { code: 0, stdout: 'true\n', stderr: '' };
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { code: 0, stdout: 'main\n', stderr: '' };
        }
        if (args[0] === 'remote') {
          if (args[1] === 'get-url') {
            const url = remotes.get(args[2] ?? '');
            return url !== undefined
              ? { code: 0, stdout: `${url}\n`, stderr: '' }
              : { code: 128, stdout: '', stderr: 'error: No such remote' };
          }
          if (args[1] === 'add') {
            remotes.set(args[2] ?? '', args[3] ?? '');
            return { code: 0, stdout: '', stderr: '' };
          }
        }
        if (args[0] === 'push') {
          return opts?.repoExists === false
            ? { code: 128, stdout: '', stderr: 'ERROR: Repository not found.' }
            : { code: 0, stdout: 'ok\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
      runGh: vi.fn(async (args: readonly string[]) => {
        if (args[0] === 'repo' && args[1] === 'view') {
          return opts?.repoExists === false
            ? { code: 1, stdout: '', stderr: 'Could not resolve to a Repository' }
            : { code: 0, stdout: '{"url":"https://github.com/claudianus/webgpu-raytracer"}', stderr: '' };
        }
        if (args[0] === 'repo' && args[1] === 'create') {
          return { code: 0, stdout: 'https://github.com/claudianus/created\n', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }),
    };
  }

  it('creates missing repos, adds origin, and pushes each target', async () => {
    const store = memoryStore();
    const source = createJob(store, { title: 'portfolio batch', kind: 'implement' });
    patchJob(store, source.id, { worktreePath: '/tmp/wt-multi' });
    const runGit = vi.fn(async (cwd: string, args: readonly string[]) => {
      // Each source_dir is its own repo; the worktree root itself is not.
      if (cwd.endsWith('webgpu-raytracer') || cwd.endsWith('gpu-fluid-sim')) {
        return { code: 0, stdout: 'true\n', stderr: '' };
      }
      return { code: 128, stdout: '', stderr: 'not a repo' };
    });
    const createdRepos = new Set<string>();
    const runGh = vi.fn(async (callArgs: readonly string[]) => {
      if (callArgs[0] === 'repo' && callArgs[1] === 'view') {
        const repoArg = callArgs[2] ?? '';
        if (createdRepos.has(repoArg)) {
          return { code: 0, stdout: `{"url":"https://github.com/${repoArg}"}`, stderr: '' };
        }
        return { code: 1, stdout: '', stderr: 'Could not resolve to a Repository' };
      }
      if (callArgs[0] === 'repo' && callArgs[1] === 'create') {
        const nameArg = callArgs[2] ?? '';
        const ownerIdx = callArgs.indexOf('--owner');
        const owner = ownerIdx >= 0 ? callArgs[ownerIdx + 1] ?? '' : 'claudianus';
        createdRepos.add(owner === '' ? nameArg : `${owner}/${nameArg}`);
        return { code: 0, stdout: 'created\n', stderr: '' };
      }
      return { code: 0, stdout: '{"url":"https://github.com/claudianus/x"}', stderr: '' };
    });

    const result = await runMultiRepoPush({
      pushJob: source,
      sourceJob: getJob(store, source.id)!,
      targets: [
        { repo: 'claudianus/webgpu-raytracer', source_dir: 'webgpu-raytracer' },
        { repo: 'claudianus/gpu-fluid-sim', source_dir: 'gpu-fluid-sim', branch: 'main' },
      ],
      runGit,
      runGh,
    });

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.ok)).toBe(true);
    const pushed = runGit.mock.calls.filter((call) => call[1][0] === 'push');
    expect(pushed).toHaveLength(2);
    expect(runGh.mock.calls.some((call) => call[0].includes('create'))).toBe(true);
  });

  it('isolates per-target failures without aborting the batch', async () => {
    const store = memoryStore();
    const source = createJob(store, { title: 'portfolio batch', kind: 'implement' });
    patchJob(store, source.id, { worktreePath: '/tmp/wt-multi' });
    const good = gitRepoRunner();
    const runGit = vi.fn(async (cwd: string, args: readonly string[]) => {
      if (cwd.endsWith('bad-dir')) {
        return { code: 128, stdout: '', stderr: 'fatal: not a git repository' };
      }
      return good.runGit(cwd, args);
    });
    const runGh = vi.fn(async (args: readonly string[]) => good.runGh(args));

    const result = await runMultiRepoPush({
      pushJob: source,
      sourceJob: getJob(store, source.id)!,
      targets: [
        { repo: 'claudianus/good-repo', source_dir: 'good-repo' },
        { repo: 'claudianus/bad-repo', source_dir: 'bad-dir' },
      ],
      runGit,
      runGh,
    });

    expect(result.ok).toBe(false);
    expect(result.results[0]?.ok).toBe(true);
    expect(result.results[1]?.ok).toBe(false);
    expect(result.results[1]?.detail).toMatch(/not a git repository/);
  });

  it('validates repo slugs', () => {
    expect(validatePushTargetRepo('webgpu-raytracer')).toBeUndefined();
    expect(validatePushTargetRepo('claudianus/webgpu-raytracer')).toBeUndefined();
    expect(validatePushTargetRepo('https://github.com/a/b')).toBeDefined();
    expect(validatePushTargetRepo('a/b/c')).toBeDefined();
    expect(validatePushTargetRepo('')).toBeDefined();
  });

  it('validates source_dir stays inside the worktree', () => {
    expect(validatePushTargetSourceDir('webgpu-raytracer')).toBeUndefined();
    expect(validatePushTargetSourceDir('packages/cli')).toBeUndefined();
    expect(validatePushTargetSourceDir('apps/my project')).toBeUndefined();
    expect(validatePushTargetSourceDir('..')).toBeDefined();
    expect(validatePushTargetSourceDir('../outside')).toBeDefined();
    expect(validatePushTargetSourceDir('a/../../b')).toBeDefined();
    expect(validatePushTargetSourceDir('/etc/passwd')).toBeDefined();
    expect(validatePushTargetSourceDir('C:\\evil')).toBeDefined();
    expect(validatePushTargetSourceDir('\\\\nas\\share')).toBeDefined();
    expect(validatePushTargetSourceDir('a//b')).toBeDefined();
    expect(validatePushTargetSourceDir('.hidden')).toBeUndefined();
    expect(validatePushTargetSourceDir('')).toBeDefined();
  });

  it('rejects escaping source_dir targets without touching the escaped path', async () => {
    const store = memoryStore();
    const source = createJob(store, { title: 'portfolio batch', kind: 'implement' });
    patchJob(store, source.id, { worktreePath: '/tmp/wt-multi' });
    const good = gitRepoRunner();
    const result = await runMultiRepoPush({
      pushJob: source,
      sourceJob: getJob(store, source.id)!,
      targets: [
        { repo: 'claudianus/escape', source_dir: '../../outside' },
        { repo: 'claudianus/abs', source_dir: 'D:\\sneaky' },
      ],
      runGit: good.runGit,
      runGh: good.runGh,
    });

    expect(result.ok).toBe(false);
    expect(result.results.every((r) => !r.ok)).toBe(true);
    expect(result.results[0]?.detail).toMatch(/worktree/);
    // No git command was ever run — the escape was rejected before join().
    expect(good.runGit).not.toHaveBeenCalled();
    expect(good.runGh).not.toHaveBeenCalled();
  });
});
