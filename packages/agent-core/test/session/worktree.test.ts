import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { LocalKaos } from '@superliora/kaos';

import { resetGitBootstrapCache, AUTO_GIT_INIT_ENV } from '#/session/git-bootstrap';
import { runGit } from '#/autopilot/git';
import {
  attachSessionWorktree,
  buildWorktreeMetadata,
  createSessionWorktree,
  gcSessionWorktrees,
  generateWorktreeName,
  hygieneSessionWorktrees,
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

  it('reattaches an existing branch after the worktree directory is deleted', async () => {
    const homeDir = await makeTempDir('liora-wt-home-reattach-');
    const repo = await makeTempDir('liora-wt-repo-reattach-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    const created = await createSessionWorktree(kaos, {
      repoPath: repo,
      name: 'reattach-me',
      homeDir,
    });
    await writeFile(join(created.workDir, 'keep.txt'), 'kept\n', 'utf-8');
    const add = await runGit(kaos, created.workDir, ['add', 'keep.txt']);
    expect(add.ok).toBe(true);
    const commit = await runGit(kaos, created.workDir, ['commit', '-m', 'keep']);
    expect(commit.ok).toBe(true);

    await runGit(kaos, repo, ['worktree', 'remove', '--force', created.workDir]);
    await rm(created.workDir, { recursive: true, force: true });

    const remounted = await attachSessionWorktree(kaos, {
      repoPath: repo,
      path: created.workDir,
      branch: created.meta.branch,
      name: created.meta.name,
      homeDir,
    });
    expect(remounted.workDir).toBe(created.workDir);
    await expect(access(join(remounted.workDir, 'keep.txt'))).resolves.toBeUndefined();
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

  it('removes the merged liora/* branch when the worktree is removed', async () => {
    const homeDir = await makeTempDir('liora-wt-home-br-');
    const repo = await makeTempDir('liora-wt-repo-br-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    await createSessionWorktree(kaos, {
      repoPath: repo,
      name: 'gone-soon',
      homeDir,
    });
    const before = await runGit(kaos, repo, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/liora/gone-soon',
    ]);
    expect(before.ok).toBe(true);

    await removeSessionWorktree(kaos, {
      homeDir,
      nameOrPath: 'gone-soon',
      repoRoot: repo,
    });

    const after = await runGit(kaos, repo, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/liora/gone-soon',
    ]);
    expect(after.ok).toBe(false);
  }, 60_000);

  it('hygiene archives then deletes unmerged orphan liora/* tips', async () => {
    const homeDir = await makeTempDir('liora-wt-home-hyg-');
    const repo = await makeTempDir('liora-wt-repo-hyg-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    // Create an orphan branch with a unique tip (not registered in the WT registry).
    const mk = async (...args: string[]) => {
      const proc = await kaos.exec(...args);
      proc.stdin.end();
      const code = await proc.wait();
      if (code !== 0) throw new Error(`failed: ${args.join(' ')}`);
    };
    await mk('git', '-C', repo, 'checkout', '-b', 'liora/orphan-unique');
    await writeFile(join(repo, 'orphan.txt'), 'unique\n', 'utf-8');
    await mk('git', '-C', repo, 'add', 'orphan.txt');
    await mk('git', '-C', repo, 'commit', '-m', 'orphan tip');
    await mk('git', '-C', repo, 'checkout', '-');

    const dry = await hygieneSessionWorktrees(kaos, {
      homeDir,
      repoRoot: repo,
      dryRun: true,
      archive: true,
    });
    expect(dry.archivedTags).toContain('archive/tips/liora-orphan-unique');
    expect(dry.deletedLocalBranches).toContain('liora/orphan-unique');

    const stillThere = await runGit(kaos, repo, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/liora/orphan-unique',
    ]);
    expect(stillThere.ok).toBe(true);

    const applied = await hygieneSessionWorktrees(kaos, {
      homeDir,
      repoRoot: repo,
      dryRun: false,
      archive: true,
    });
    expect(applied.archivedTags).toContain('archive/tips/liora-orphan-unique');
    expect(applied.deletedLocalBranches).toContain('liora/orphan-unique');

    const branchGone = await runGit(kaos, repo, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/liora/orphan-unique',
    ]);
    expect(branchGone.ok).toBe(false);

    const tagKept = await runGit(kaos, repo, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/tags/archive/tips/liora-orphan-unique',
    ]);
    expect(tagKept.ok).toBe(true);
  }, 60_000);

  it('hygiene deletes merged orphan liora/* branches without archiving', async () => {
    const homeDir = await makeTempDir('liora-wt-home-merged-');
    const repo = await makeTempDir('liora-wt-repo-merged-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    const mk = async (...args: string[]) => {
      const proc = await kaos.exec(...args);
      proc.stdin.end();
      const code = await proc.wait();
      if (code !== 0) throw new Error(`failed: ${args.join(' ')}`);
    };
    // Branch tip == HEAD → already an ancestor of HEAD; no unique commits.
    await mk('git', '-C', repo, 'branch', 'liora/orphan-merged');

    const result = await hygieneSessionWorktrees(kaos, {
      homeDir,
      repoRoot: repo,
      archive: true,
    });
    expect(result.deletedLocalBranches).toContain('liora/orphan-merged');
    expect(result.archivedTags).not.toContain('archive/tips/liora-orphan-merged');

    const gone = await runGit(kaos, repo, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/liora/orphan-merged',
    ]);
    expect(gone.ok).toBe(false);
  }, 60_000);
});
