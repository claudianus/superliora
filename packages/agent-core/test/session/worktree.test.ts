import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { LocalKaos } from '@superliora/kaos';

import { resetGitBootstrapCache, AUTO_GIT_INIT_ENV } from '#/session/git-bootstrap';
import {
  buildWorktreeMetadata,
  createSessionWorktree,
  gcSessionWorktrees,
  generateWorktreeName,
  isSessionWorktreeMeta,
  listSessionWorktrees,
  normalizeWorktreeName,
  removeSessionWorktree,
  resolveGitRepoRoot,
  sessionWorktreeFromCustom,
  worktreesRoot,
} from '#/session/worktree';
import { ErrorCodes, LioraError } from '#/errors/index';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initGitRepo(kaos: LocalKaos, root: string): Promise<void> {
  const run = async (...args: string[]) => {
    const proc = await kaos.exec(...args);
    proc.stdin.end();
    const code = await proc.wait();
    if (code !== 0) {
      throw new Error(`git command failed (${code}): ${args.join(' ')}`);
    }
  };
  await run('git', '-C', root, 'init');
  await run('git', '-C', root, 'config', 'user.email', 'test@example.com');
  await run('git', '-C', root, 'config', 'user.name', 'Test');
  await writeFile(join(root, 'README.md'), '# test\n', 'utf-8');
  await run('git', '-C', root, 'add', 'README.md');
  await run('git', '-C', root, 'commit', '-m', 'init');
}

describe('session worktree helpers', () => {
  it('normalizes and rejects invalid names', () => {
    expect(normalizeWorktreeName('Fix Auth')).toBe('fix-auth');
    expect(() => normalizeWorktreeName('../escape')).toThrow(LioraError);
    expect(() => normalizeWorktreeName('a/b')).toThrow(LioraError);
    expect(generateWorktreeName('my-feature')).toBe('my-feature');
    expect(generateWorktreeName()).toMatch(/^wt-/);
  });

  it('builds and parses session metadata', () => {
    const meta = {
      path: '/tmp/wt',
      branch: 'liora/wt',
      repoRoot: '/tmp/repo',
      name: 'wt',
      baseRef: 'HEAD',
      createdAt: new Date().toISOString(),
    };
    expect(isSessionWorktreeMeta(meta)).toBe(true);
    const custom = buildWorktreeMetadata(meta);
    expect(sessionWorktreeFromCustom(custom)).toEqual(meta);
    expect(sessionWorktreeFromCustom({})).toBeUndefined();
  });
});

describe('session worktree lifecycle', () => {
  beforeEach(() => {
    resetGitBootstrapCache();
  });

  it('creates, lists, and removes isolated worktrees', async () => {
    const homeDir = await makeTempDir('liora-wt-home-');
    const repo = await makeTempDir('liora-wt-repo-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    const root = await resolveGitRepoRoot(kaos, repo);
    expect(await realpath(root)).toBe(await realpath(repo));

    const a = await createSessionWorktree(kaos, {
      repoPath: repo,
      name: 'feature-a',
      homeDir,
      sessionId: 'sess-a',
    });
    const b = await createSessionWorktree(kaos, {
      repoPath: repo,
      name: 'feature-b',
      homeDir,
      sessionId: 'sess-b',
    });

    expect(a.workDir).not.toBe(b.workDir);
    expect(a.workDir.startsWith(worktreesRoot(homeDir))).toBe(true);
    expect(a.meta.branch).toBe('liora/feature-a');
    expect(b.meta.branch).toBe('liora/feature-b');

    // Isolation: write in A does not appear in B
    await writeFile(join(a.workDir, 'only-a.txt'), 'a\n', 'utf-8');
    await expect(access(join(b.workDir, 'only-a.txt'))).rejects.toBeTruthy();

    const listed = await listSessionWorktrees({ homeDir, repoRoot: repo });
    expect(listed.map((e) => e.name).toSorted()).toEqual(['feature-a', 'feature-b']);

    const removed = await removeSessionWorktree(kaos, {
      homeDir,
      nameOrPath: 'feature-a',
      repoRoot: repo,
    });
    expect(removed.name).toBe('feature-a');

    const after = await listSessionWorktrees({ homeDir, repoRoot: repo });
    expect(after.map((e) => e.name)).toEqual(['feature-b']);

    // Duplicate name fails
    await expect(
      createSessionWorktree(kaos, { repoPath: repo, name: 'feature-b', homeDir }),
    ).rejects.toMatchObject({ code: ErrorCodes.WORKTREE_ALREADY_EXISTS });

    // GC dry-run keeps entries when fresh
    const gc = await gcSessionWorktrees(kaos, { homeDir, maxAgeDays: 30, dryRun: true });
    expect(gc.removed.length).toBe(0);
    expect(gc.kept).toBe(1);
  }, 60_000);

  it('auto-bootstraps a non-git directory and creates the worktree', async () => {
    const homeDir = await makeTempDir('liora-wt-home-new-');
    const dir = await makeTempDir('liora-wt-new-');
    const kaos = await LocalKaos.create();
    await writeFile(join(dir, 'hello.txt'), 'hello\n', 'utf-8');

    const created = await createSessionWorktree(kaos, {
      repoPath: dir,
      name: 'fresh-start',
      homeDir,
      env: {},
    });

    expect(await realpath(created.meta.repoRoot)).toBe(await realpath(dir));
    expect(created.meta.branch).toBe('liora/fresh-start');
    // Baseline snapshot must be present in the worktree checkout.
    await expect(access(join(created.workDir, 'hello.txt'))).resolves.toBeUndefined();
  }, 60_000);

  it('auto-bootstraps a completely empty folder (no files, no commits)', async () => {
    const homeDir = await makeTempDir('liora-wt-home-empty-');
    const dir = await makeTempDir('liora-wt-empty-');
    const kaos = await LocalKaos.create();

    const created = await createSessionWorktree(kaos, {
      repoPath: dir,
      name: 'empty-start',
      homeDir,
      env: {},
    });

    expect(created.meta.branch).toBe('liora/empty-start');
    expect(created.workDir.startsWith(worktreesRoot(homeDir))).toBe(true);
  }, 60_000);

  it('rejects non-git directories when auto bootstrap is opted out', async () => {
    const homeDir = await makeTempDir('liora-wt-home-nogit-');
    const dir = await makeTempDir('liora-wt-nogit-');
    const kaos = await LocalKaos.create();
    await expect(
      createSessionWorktree(kaos, {
        repoPath: dir,
        name: 'x',
        homeDir,
        env: { [AUTO_GIT_INIT_ENV]: '0' },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.WORKTREE_NOT_A_GIT_REPO });
  });
});
