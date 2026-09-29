import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalKaos } from '@superliora/kaos';

/**
 * Windows returns EBUSY/EPERM from a recursive delete whenever any file under
 * the tree is still open. The old code swallowed that failure and dropped the
 * registry entry anyway, leaving a directory full of uncommitted work that no
 * registry-walking command (`list`, `gc`, `hygiene`) could reach again.
 *
 * `rm` is mocked at module level so the locked-directory case is reachable
 * from any platform; `force: true` is deliberately preserved in the assertion
 * below, because dropping it would also silence a genuine ENOENT.
 */
let rmFailure: Error | undefined;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: actual,
    rm: vi.fn(async (path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
      if (rmFailure !== undefined && options?.recursive === true) throw rmFailure;
      return actual.rm(path, options);
    }),
  };
});

const { createSessionWorktree, gcSessionWorktrees, listSessionWorktrees, removeSessionWorktree, worktreeRegistryPath } =
  await import('#/session/worktree');

const tempDirs: string[] = [];

beforeEach(() => {
  rmFailure = undefined;
});

afterEach(async () => {
  rmFailure = undefined;
  vi.clearAllMocks();
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
  const run = async (...args: string[]): Promise<void> => {
    const proc = await kaos.exec(...args);
    proc.stdin.end();
    const code = await proc.wait();
    if (code !== 0) throw new Error(`git command failed (${code}): ${args.join(' ')}`);
  };
  await run('git', '-C', root, 'init');
  await run('git', '-C', root, 'config', 'user.email', 'test@example.com');
  await run('git', '-C', root, 'config', 'user.name', 'Test');
  await writeFile(join(root, 'README.md'), '# test\n', 'utf-8');
  await run('git', '-C', root, 'add', 'README.md');
  await run('git', '-C', root, 'commit', '-m', 'init');
}

function eperm(): Error {
  return Object.assign(new Error('EBUSY: resource busy or locked, rmdir'), { code: 'EBUSY' });
}

describe('worktree removal safety', () => {
  it('keeps the registry entry and reports the failure when the tree is locked', async () => {
    const homeDir = await makeTempDir('liora-wt-rmfail-home-');
    const repo = await makeTempDir('liora-wt-rmfail-repo-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    const created = await createSessionWorktree(kaos, {
      repoPath: repo,
      name: 'locked-work',
      homeDir,
    });
    await writeFile(join(created.workDir, 'uncommitted.txt'), 'work in progress\n', 'utf-8');

    rmFailure = eperm();
    await expect(
      removeSessionWorktree(kaos, { homeDir, nameOrPath: 'locked-work', repoRoot: repo }),
    ).rejects.toMatchObject({ code: 'EBUSY' });

    const listed = await listSessionWorktrees({ homeDir, repoRoot: repo });
    expect(listed.map((e) => e.name)).toContain('locked-work');
  }, 60_000);

  it('gc keeps an entry whose directory could not be removed', async () => {
    const homeDir = await makeTempDir('liora-wt-gcfail-home-');
    const repo = await makeTempDir('liora-wt-gcfail-repo-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    await createSessionWorktree(kaos, { repoPath: repo, name: 'gc-locked', homeDir });

    // Age the entry past the GC cutoff.
    const stamp = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const registryPath = worktreeRegistryPath(homeDir);
    const raw = JSON.parse(await readFile(registryPath, 'utf-8')) as {
      version: number;
      entries: { lastAccessedAt: string }[];
    };
    for (const entry of raw.entries) entry.lastAccessedAt = stamp;
    await writeFile(registryPath, JSON.stringify(raw), 'utf-8');

    rmFailure = eperm();
    const result = await gcSessionWorktrees(kaos, { homeDir, maxAgeDays: 1 });

    expect(result.removed.map((e) => e.name)).not.toContain('gc-locked');
    expect(result.kept).toBe(1);
    expect((await listSessionWorktrees({ homeDir, repoRoot: repo })).map((e) => e.name)).toEqual([
      'gc-locked',
    ]);
  }, 60_000);

  it('removes a worktree normally when the delete succeeds', async () => {
    const homeDir = await makeTempDir('liora-wt-ok-home-');
    const repo = await makeTempDir('liora-wt-ok-repo-');
    const kaos = await LocalKaos.create();
    await initGitRepo(kaos, repo);

    await createSessionWorktree(kaos, { repoPath: repo, name: 'clean', homeDir });
    const removed = await removeSessionWorktree(kaos, {
      homeDir,
      nameOrPath: 'clean',
      repoRoot: repo,
    });

    expect(removed.name).toBe('clean');
    expect(await listSessionWorktrees({ homeDir, repoRoot: repo })).toHaveLength(0);
  }, 60_000);
});
