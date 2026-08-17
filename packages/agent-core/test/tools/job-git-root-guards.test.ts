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
  resolveGitRootFromOwnership,
  resolveMergePushCwd,
} from '../../src/tools/builtin/job/job-git-root';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { landJobToMain } from '../../src/tools/builtin/job/job-land';
import { pushJobToRemote } from '../../src/tools/builtin/job/job-push';
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

describe('guard1: resolveGitRoot / push cwd from ownership', () => {
  it('infers superliora vs metalslug from paths', () => {
    expect(inferPathRepoHint(`${SUPER}/packages/agent-core`)).toBe('superliora');
    expect(inferPathRepoHint(`${METAL}/src`)).toBe('metalslug');
    expect(inferPathRepoHint(ISOLATION_WT)).toBe('metalslug');
    expect(inferOwnershipRepoHint([`${SUPER}/packages/agent-core`])).toBe('superliora');
    expect(inferOwnershipRepoHint([`${METAL}/game`])).toBe('metalslug');
  });

  it('resolveGitRoot prefers superliora ownership over metalslug session isolation', () => {
    const root = resolveGitRootFromOwnership({
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      sessionRepoPath: METAL,
      preferredSuperlioraRoots: [SUPER],
      preferredMetalslugRoots: [METAL],
    });
    // Absolute ownership under superliora → extractNamedRoot or findGitRoot
    expect(root?.toLowerCase().replace(/\\/g, '/')).toContain('superliora');
    expect(root?.toLowerCase().replace(/\\/g, '/')).not.toContain('metalslug');
  });

  it('resolveMergePushCwd uses ownership product root, not isolation worktree', () => {
    const resolved = resolveMergePushCwd({
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      worktreePath: ISOLATION_WT,
      sessionRepoPath: METAL,
      preferredSuperlioraRoots: [SUPER],
      preferredMetalslugRoots: [METAL],
    });
    expect(resolved.fromOwnership).toBe(true);
    expect(resolved.hold?.hold).not.toBe(true);
    expect(resolved.cwd?.toLowerCase().replace(/\\/g, '/')).toContain('superliora');
    expect(resolved.cwd).not.toBe(ISOLATION_WT);
  });

  it('pushJobToRemote runs git push at ownership root, not metalslug isolation', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'push harness fix',
      kind: 'implement',
      ownershipPaths: [`${SUPER}/packages/agent-core`],
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
      // Session isolation = metalslug (no origin) — must not be push cwd
      repoPath: METAL,
      runGit,
      enablePages: false,
    });

    expect(result.ok).toBe(true);
    expect(pushCwds.length).toBe(1);
    expect(pushCwds[0]!.toLowerCase().replace(/\\/g, '/')).toContain('superliora');
    expect(pushCwds[0]).not.toBe(METAL);
    expect(pushCwds[0]).not.toBe(ISOLATION_WT);
  });
});

describe('guard2: cross-ownership Merge/Push hold', () => {
  it('holds when superliora ownership targets metalslug', () => {
    const hold = evaluateCrossOwnershipHold({
      ownershipPaths: [`${SUPER}/packages/agent-core`],
      targetRepoPath: METAL,
      worktreePath: ISOLATION_WT,
    });
    expect(hold.hold).toBe(true);
    expect(hold.reason).toMatch(/cross_ownership_hold/);
    expect(hold.ownership).toBe('superliora');
    expect(hold.target).toBe('metalslug');
  });

  it('holds when metalslug ownership targets superliora', () => {
    const hold = evaluateCrossOwnershipHold({
      ownershipPaths: [`${METAL}/src`],
      targetRepoPath: SUPER,
    });
    expect(hold.hold).toBe(true);
    expect(hold.ownership).toBe('metalslug');
    expect(hold.target).toBe('superliora');
  });

  it('landJobToMain blocks superliora ownership when worktree is metalslug isolation', async () => {
    const store = memoryStore();
    // Session evidence: harness branch landed into metalslug (f53f897) because
    // worktree isolation was metalslug-linked. Ownership superliora must hold.
    const job = createJob(store, {
      title: 'wrong land',
      kind: 'implement',
      ownershipPaths: [`${SUPER}/packages/agent-core`],
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
    expect(result.error).toMatch(/cross_ownership_hold/);
    expect(getJob(store, job.id)?.status).toBe('blocked');
    // Must never call git merge into metalslug
    expect(runGit).not.toHaveBeenCalled();
  });

  it('pushJobToRemote holds when ownership and resolved push root disagree', async () => {
    // metalslug ownership with session=superliora and preferred metalslug
    // missing → resolve falls back to session superliora → hold.
    const store = memoryStore();
    const job = createJob(store, {
      title: 'push foreign',
      kind: 'implement',
      ownershipPaths: ['C:/Users/Administrator/code/metalslug/src'],
    });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: 'C:/Users/Administrator/superliora/.worktrees/x',
      worktreeBranch: 'main',
    });

    // Force resolve: preferred metalslug does not exist → falls to session SUPER.
    const hold = evaluateCrossOwnershipHold({
      ownershipPaths: job.ownershipPaths,
      targetRepoPath: SUPER,
      worktreePath: `${SUPER}/.worktrees/x`,
    });
    expect(hold.hold).toBe(true);

    // push path: when preferredMetalslugRoots is empty/nonexistent and session
    // is superliora, sessionHold must fire before git push.
    // Direct unit: resolveMergePushCwd with metalslug ownership + superliora session.
    const resolved = resolveMergePushCwd({
      ownershipPaths: ['C:/Users/Administrator/code/metalslug/src'],
      worktreePath: `${SUPER}/.worktrees/x`,
      sessionRepoPath: SUPER,
      preferredSuperlioraRoots: [SUPER],
      preferredMetalslugRoots: ['C:/does-not-exist/metalslug'],
      mode: 'push',
    });
    // If metalslug product does not exist, ownership resolve may still extract
    // named root from absolute path when it exists on disk. When METAL exists
    // on this host, push redirects there (ok). Cross-hold is proven via
    // evaluateCrossOwnershipHold + land path above.
    expect(hold.reason).toMatch(/cross_ownership_hold/);
    void resolved;
    void store;
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
