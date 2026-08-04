import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalKaos } from '@superliora/kaos';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureGitRepoForWorktrees,
  GIT_BOOTSTRAP_BASELINE_MESSAGE,
  resetGitBootstrapCache,
  SUPERLIORA_AUTO_GIT_INIT_ENV,
} from '../../src/tools/builtin/job/job-git-bootstrap';
import { assignJobWorktree } from '../../src/tools/builtin/job/job-runtime';
import { createJob } from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key: string) {
      return data[key] as never;
    },
    set(key: string, value: unknown) {
      data[key] = value;
    },
  } as unknown as ToolStore;
}

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function git(kaos: LocalKaos, cwd: string, ...args: string[]): Promise<string> {
  const proc = await kaos.exec('git', '-C', cwd, ...args);
  proc.stdin.end();
  let out = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (c: string) => {
    out += c;
  });
  const code = await proc.wait();
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed (${code})`);
  return out.trim();
}

describe('ensureGitRepoForWorktrees', () => {
  let kaos: LocalKaos;

  beforeEach(async () => {
    resetGitBootstrapCache();
    kaos = await LocalKaos.create();
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('passes through an existing git repository unchanged', async () => {
    const repo = await makeTempDir('liora-gitok-');
    await git(kaos, repo, 'init');
    await git(kaos, repo, 'config', 'user.email', 'test@example.com');
    await git(kaos, repo, 'config', 'user.name', 'Test');
    await writeFile(join(repo, 'README.md'), '# x\n', 'utf-8');
    await git(kaos, repo, 'add', '-A');
    await git(kaos, repo, 'commit', '-m', 'init');

    const result = await ensureGitRepoForWorktrees(kaos, repo, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bootstrapped).toBe(false);
    expect(result.baselineCommit).toBe(false);
    expect(result.root).toBe(await git(kaos, repo, 'rev-parse', '--show-toplevel'));
  });

  it('bootstraps a non-git directory with init + baseline commit', async () => {
    const repo = await makeTempDir('liora-gitnew-');
    await writeFile(join(repo, 'app.js'), 'console.log(1);\n', 'utf-8');

    const result = await ensureGitRepoForWorktrees(kaos, repo, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bootstrapped).toBe(true);
    expect(result.baselineCommit).toBe(true);

    const subject = await git(kaos, repo, 'log', '-1', '--format=%s');
    expect(subject).toBe(GIT_BOOTSTRAP_BASELINE_MESSAGE);
    // Worktree base ref must exist.
    await expect(git(kaos, repo, 'rev-parse', '--verify', 'HEAD')).resolves.toBeDefined();
  });

  it('bootstraps a completely empty directory with an empty baseline commit', async () => {
    const repo = await makeTempDir('liora-gitempty-');

    const result = await ensureGitRepoForWorktrees(kaos, repo, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bootstrapped).toBe(true);
    expect(result.baselineCommit).toBe(true);

    // `git worktree add HEAD` must work afterwards — the original failure mode.
    await expect(git(kaos, repo, 'rev-parse', '--verify', 'HEAD')).resolves.toBeDefined();
    const subject = await git(kaos, repo, 'log', '-1', '--format=%s');
    expect(subject).toBe(GIT_BOOTSTRAP_BASELINE_MESSAGE);
  });

  it('adds a baseline commit to an initialized repo with no commits (unborn HEAD)', async () => {
    const repo = await makeTempDir('liora-gitunborn-');
    await git(kaos, repo, 'init');
    await writeFile(join(repo, 'a.txt'), 'a\n', 'utf-8');

    const result = await ensureGitRepoForWorktrees(kaos, repo, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bootstrapped).toBe(false);
    expect(result.baselineCommit).toBe(true);
    await expect(git(kaos, repo, 'rev-parse', '--verify', 'HEAD')).resolves.toBeDefined();
  });

  it('honors the legacy conductor opt-out env too', async () => {
    const repo = await makeTempDir('liora-gitlegacyoptout-');
    const result = await ensureGitRepoForWorktrees(kaos, repo, {
      SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT: '0',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT');
  });

  it('memoizes a successful bootstrap per path', async () => {
    const repo = await makeTempDir('liora-gitmemo-');
    await writeFile(join(repo, 'a.txt'), 'a\n', 'utf-8');

    const first = await ensureGitRepoForWorktrees(kaos, repo, {});
    const second = await ensureGitRepoForWorktrees(kaos, repo, {});
    expect(second).toBe(first);
    const commits = await git(kaos, repo, 'rev-list', '--count', 'HEAD');
    expect(commits).toBe('1');
  });

  it('honors the opt-out env and does not initialize', async () => {
    const repo = await makeTempDir('liora-gitoptout-');
    const result = await ensureGitRepoForWorktrees(kaos, repo, {
      [SUPERLIORA_AUTO_GIT_INIT_ENV]: '0',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(SUPERLIORA_AUTO_GIT_INIT_ENV);
    expect(result.error).toContain('git init');
    await expect(git(kaos, repo, 'rev-parse', '--git-dir')).rejects.toThrow();
  });

  it('does not cache failures so a later attempt can retry', async () => {
    const repo = await makeTempDir('liora-gitretry-');
    await writeFile(join(repo, 'a.txt'), 'a\n', 'utf-8');
    const blocked = await ensureGitRepoForWorktrees(kaos, repo, {
      [SUPERLIORA_AUTO_GIT_INIT_ENV]: 'off',
    });
    expect(blocked.ok).toBe(false);
    const retry = await ensureGitRepoForWorktrees(kaos, repo, {});
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.bootstrapped).toBe(true);
  });
});

describe('assignJobWorktree with git bootstrap', () => {
  let kaos: LocalKaos;

  beforeEach(async () => {
    resetGitBootstrapCache();
    kaos = await LocalKaos.create();
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('progresses a Job in a non-git project by bootstrapping the repo', async () => {
    const repo = await makeTempDir('liora-jobnew-');
    await writeFile(join(repo, 'main.py'), 'print(1)\n', 'utf-8');
    const store = memoryStore();
    const job = createJob(store, { title: 'work in fresh dir' });

    const seen: string[] = [];
    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos,
      repoPath: repo,
      env: {},
      createWorktree: async (_kaos, input) => {
        seen.push(input.repoPath);
        return {
          workDir: join(repo, '.fake-worktree'),
          meta: {} as never,
          record: {} as never,
        };
      },
    });

    expect(assigned.error).toBeUndefined();
    expect(assigned.job?.worktreePath).toBe(join(repo, '.fake-worktree'));
    expect(seen).toEqual([repo]);
    expect(assigned.job?.notes).toContain('git_bootstrap: initialized');
  });

  it('blocks the Job with actionable guidance when bootstrap is opted out', async () => {
    const repo = await makeTempDir('liora-joboptout-');
    const store = memoryStore();
    const job = createJob(store, { title: 'blocked in fresh dir' });

    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos,
      repoPath: repo,
      env: { [SUPERLIORA_AUTO_GIT_INIT_ENV]: '0' },
      createWorktree: async () => {
        throw new Error('must not run');
      },
    });

    expect(assigned.error).toContain(SUPERLIORA_AUTO_GIT_INIT_ENV);
    expect(assigned.job?.status).toBe('blocked');
    expect(assigned.job?.notes).toContain('worktree_failed:');
    expect(assigned.job?.notes).toContain('JobResume');
  });
});
