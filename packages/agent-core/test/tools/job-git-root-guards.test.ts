/**
 * Three harness guards:
 * 1) resolveGitRoot / push cwd from ownership (not metalslug isolation)
 * 2) cross-ownership Merge/Push hold
 * 3) host_browser=einval — visual failed but mechanical-green implement not hard-fail
 */

import { describe, expect, it, vi } from 'vitest';

import {
  classifyHostBrowserFromText,
  createVerificationSensorLedger,
  observeVerificationToolResult,
} from '../../src/sensors/verification-sensor-ledger';
import {
  buildSubagentResultContract,
  computeVerificationFailed,
  verificationHasFailure,
  verificationIsGreen,
} from '../../src/session/subagent/subagent-result-contract';
import {
  evaluateCrossOwnershipHold,
  inferOwnershipRepoHint,
  inferPathRepoHint,
  isAbsoluteRepoPath,
  mainCheckoutFromPath,
  resolveGitRootFromOwnership,
  resolveMergePushCwd,
} from '../../src/tools/builtin/job/job-git-root';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { landJobToMain } from '../../src/tools/builtin/job/job-land';
import { pushJobToRemote } from '../../src/tools/builtin/job/job-push';
import { assignJobWorktree } from '../../src/tools/builtin/job/job-runtime';
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

const SUPER = 'C:/Users/Administrator/superliora';
const METAL = 'C:/Users/Administrator/code/metalslug';
const ISOLATION_WT =
  'C:/Users/Administrator/.superliora/worktrees/metalslug-6394865b/conductor-jmswlvown18jrcs';

function slash(path: string | undefined): string {
  return (path ?? '').toLowerCase().replace(/\\/g, '/');
}

describe('guard1: persist repo identity; never follow live session cwd', () => {
  it('infers superliora vs metalslug from paths (off-disk name hints)', () => {
    expect(inferPathRepoHint(`${SUPER}/packages/agent-core`)).toBe('superliora');
    expect(inferPathRepoHint(`${METAL}/src`)).toBe('metalslug');
    expect(inferPathRepoHint(ISOLATION_WT)).toBe('metalslug');
    expect(inferOwnershipRepoHint([`${SUPER}/packages/agent-core`])).toBe('superliora');
    expect(inferOwnershipRepoHint([`${METAL}/game`])).toBe('metalslug');
  });

  it('persisted repoRoot wins over a later metalslug session cwd', () => {
    const root = resolveGitRootFromOwnership({
      persistedRepoRoot: SUPER,
      ownershipPaths: ['packages/agent-core'],
      sessionRepoPath: METAL,
    });
    expect(slash(root)).toContain('superliora');
    expect(slash(root)).not.toContain('metalslug');
  });

  it('absolute ownership beats session cwd without scanning a second product list', () => {
    const root = resolveGitRootFromOwnership({
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      sessionRepoPath: METAL,
    });
    expect(slash(root)).toContain('superliora');
    expect(slash(root)).not.toContain('metalslug');
  });

  it('relative ownership stays under the session and does not steal another checkout', () => {
    const root = resolveGitRootFromOwnership({
      ownershipPaths: ['packages/agent-core'],
      sessionRepoPath: METAL,
    });
    expect(slash(root)).toContain('metalslug');
    expect(slash(root)).not.toContain('superliora');
  });

  it('does not resolve a Windows drive path against process.cwd() on POSIX', () => {
    expect(isAbsoluteRepoPath(SUPER)).toBe(true);
    expect(isAbsoluteRepoPath(ISOLATION_WT)).toBe(true);
    if (process.platform === 'win32') return;
    expect(mainCheckoutFromPath(SUPER)).toBeUndefined();
    expect(mainCheckoutFromPath(ISOLATION_WT)).toBeUndefined();
    const root = resolveGitRootFromOwnership({
      persistedRepoRoot: SUPER,
      sessionRepoPath: process.cwd(),
    });
    expect(slash(root)).toBe(slash(SUPER));
    expect(slash(root)).not.toBe(slash(process.cwd()));
  });

  it('createJob stamps repoRoot from sessionRepoPath; children inherit it', () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'parent',
      kind: 'implement',
      sessionRepoPath: SUPER,
    });
    expect(slash(parent.repoRoot)).toContain('superliora');

    const child = createJob(store, {
      title: 'child',
      kind: 'implement',
      parentJobId: parent.id,
      sessionRepoPath: METAL,
    });
    expect(slash(child.repoRoot)).toBe(slash(parent.repoRoot));
    expect(slash(child.repoRoot)).not.toContain('metalslug');
  });

  it('push cwd is the job product root, not isolation or a later session', () => {
    const resolved = resolveMergePushCwd({
      persistedRepoRoot: SUPER,
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      worktreePath: ISOLATION_WT,
      sessionRepoPath: METAL,
      mode: 'push',
    });
    expect(resolved.fromOwnership).toBe(true);
    expect(resolved.hold?.hold).not.toBe(true);
    expect(slash(resolved.cwd)).toContain('superliora');
    expect(resolved.cwd).not.toBe(ISOLATION_WT);
    expect(resolved.cwd).not.toBe(METAL);
  });

  it('pushJobToRemote runs git push at persisted repoRoot, not metalslug isolation', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'push harness fix',
      kind: 'implement',
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      repoRoot: SUPER,
    });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: ISOLATION_WT,
      worktreeBranch: 'liora/conductor-jmswlvown18jrcs',
    });

    const pushCwds: string[] = [];
    const runGit = vi.fn(async (cwd: string, args: readonly string[]) => {
      if (args[0] === 'push') {
        pushCwds.push(cwd);
        return { code: 0, stdout: 'ok\n', stderr: '' };
      }
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'abcdef0123456789\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const result = await pushJobToRemote({
      store,
      job: getJob(store, job.id)!,
      remote: 'origin',
      localRef: 'liora/conductor-jmswlvown18jrcs',
      remoteRef: 'liora/conductor-jmswlvown18jrcs',
      repoPath: METAL,
      runGit,
      enablePages: false,
    });

    expect(result.ok).toBe(true);
    expect(pushCwds.length).toBe(1);
    expect(slash(pushCwds[0])).toContain('superliora');
    expect(pushCwds[0]).not.toBe(METAL);
    expect(pushCwds[0]).not.toBe(ISOLATION_WT);
  });

  it('assignJobWorktree creates isolation from persisted repoRoot, not session cwd', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'wt identity', repoRoot: SUPER });
    const seen: string[] = [];
    const assigned = await assignJobWorktree({
      store,
      jobId: job.id,
      kaos: {} as never,
      repoPath: METAL,
      ensureGitRepo: false,
      createWorktree: async (_kaos, input) => {
        seen.push(input.repoPath);
        return {
          workDir: `/tmp/worktrees/${input.name}`,
          meta: {
            path: `/tmp/worktrees/${input.name}`,
            branch: `liora/${input.name}`,
            repoRoot: input.repoPath,
            name: input.name,
            baseRef: 'HEAD',
            createdAt: new Date().toISOString(),
          },
          record: {
            name: input.name,
            path: `/tmp/worktrees/${input.name}`,
            repoRoot: input.repoPath,
            branch: `liora/${input.name}`,
            baseRef: 'HEAD',
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
          },
        };
      },
    });

    expect(assigned.error).toBeUndefined();
    expect(seen.length).toBe(1);
    expect(slash(seen[0])).toContain('superliora');
    expect(slash(seen[0])).not.toContain('metalslug');
    expect(slash(getJob(store, job.id)?.repoRoot)).toContain('superliora');
  });
});

describe('guard2: cross-repo land hold', () => {
  it('holds when superliora ownership targets metalslug', () => {
    const hold = evaluateCrossOwnershipHold({
      persistedRepoRoot: SUPER,
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      targetRepoPath: METAL,
      worktreePath: ISOLATION_WT,
    });
    expect(hold.hold).toBe(true);
    expect(hold.reason).toMatch(/cross_(repo|ownership)_hold/);
    expect(slash(hold.ownership)).toContain('superliora');
    expect(slash(hold.target)).toContain('metalslug');
  });

  it('holds when metalslug ownership targets superliora', () => {
    const hold = evaluateCrossOwnershipHold({
      persistedRepoRoot: METAL,
      ownershipPaths: [`${METAL}/src`],
      targetRepoPath: SUPER,
    });
    expect(hold.hold).toBe(true);
    expect(hold.reason).toMatch(/cross_(repo|ownership)_hold/);
    expect(slash(hold.ownership)).toContain('metalslug');
    expect(slash(hold.target)).toContain('superliora');
  });

  it('holds off-disk name hints when neither checkout is present', () => {
    const hold = evaluateCrossOwnershipHold({
      ownershipPaths: ['C:/does-not-exist/superliora/packages/x'],
      targetRepoPath: 'C:/does-not-exist/code/metalslug',
    });
    expect(hold.hold).toBe(true);
    expect(hold.reason).toMatch(/cross_ownership_hold/);
    expect(hold.ownership).toBe('superliora');
    expect(hold.target).toBe('metalslug');
  });

  it('landJobToMain blocks a superliora job when the worktree is metalslug isolation', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'wrong land',
      kind: 'implement',
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      repoRoot: SUPER,
    });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: ISOLATION_WT,
      worktreeBranch: 'liora/conductor-jmswiadxfnt29hi',
      resultSummary: 'done',
    });

    const runGit = vi.fn(async () => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: METAL,
      runGit,
      gcOnSuccess: false,
    });

    expect(result.ok).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.error).toMatch(/cross_(repo|ownership)_hold/);
    expect(getJob(store, job.id)?.status).toBe('blocked');
    expect(runGit).not.toHaveBeenCalled();
  });

  it('land holds when worktree main checkout disagrees with persisted repoRoot', () => {
    const resolved = resolveMergePushCwd({
      persistedRepoRoot: SUPER,
      worktreePath: ISOLATION_WT,
      sessionRepoPath: METAL,
      mode: 'land',
    });
    expect(resolved.hold?.hold).toBe(true);
    expect(resolved.hold?.reason).toMatch(/cross_(repo|ownership)_hold/);
  });
});

describe('guard3: host_browser=einval vs implement fail', () => {
  it('classifies EINVAL from VerifySurface output', () => {
    expect(classifyHostBrowserFromText('Error: spawn EINVAL')).toBe('einval');
    expect(classifyHostBrowserFromText('Browser-use runtime is not available')).toBe(
      'missing',
    );
  });

  it('records host_browser=einval on the sensor ledger; visual stays failed', () => {
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(ledger, 'VerifySurface', {}, {
      isError: true,
      output: JSON.stringify({
        pass: false,
        axes: { load: 'failed', interaction: 'not_run', craft: 'not_run' },
        consoleErrors: [],
        notes: ['spawn EINVAL on Windows host'],
      }),
    });
    expect(ledger.visualVerdict).toBe('failed');
    expect(ledger.hostBrowser).toBe('einval');
    expect(ledger.failures.some((f) => f.summary.includes('host_browser=einval'))).toBe(
      true,
    );
  });

  it('mechanical-green + host_browser=einval → verification_failed false (visual still failed)', () => {
    const verification = {
      tests: 'passed' as const,
      typecheck: 'passed' as const,
      lint: 'passed' as const,
      visual: 'failed' as const,
      host_browser: 'einval' as const,
    };
    expect(verificationIsGreen(verification)).toBe(true);
    expect(computeVerificationFailed(verification)).toBe(false);
    // verificationHasFailure also excludes einval visual so merge green path
    // does not invent product fail — visual proof gate still uses visual=failed.
    expect(verificationHasFailure(verification)).toBe(false);

    const contract = buildSubagentResultContract({
      agentId: 'a',
      profile: 'implement',
      summary: 'mechanical green',
      filesChanged: ['packages/agent-core/src/x.ts'],
      verification,
    });
    expect(contract.verification.visual).toBe('failed');
    expect(contract.verification.host_browser).toBe('einval');
    expect(contract.verification_failed).toBe(false);
  });

  it('real visual product fail still hard-fails when not einval', () => {
    const verification = {
      tests: 'passed' as const,
      typecheck: 'passed' as const,
      lint: 'passed' as const,
      visual: 'failed' as const,
    };
    expect(computeVerificationFailed(verification)).toBe(true);
    expect(verificationHasFailure(verification)).toBe(true);
  });

  it('product check fail still hard-fails even with host_browser=einval', () => {
    const verification = {
      tests: 'failed' as const,
      typecheck: 'passed' as const,
      lint: 'passed' as const,
      visual: 'failed' as const,
      host_browser: 'einval' as const,
    };
    expect(computeVerificationFailed(verification)).toBe(true);
  });
});
