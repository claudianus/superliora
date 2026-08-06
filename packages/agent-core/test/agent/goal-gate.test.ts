import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

import { auditGoalGate, gitWorkspaceHash, type GateRunResult } from '../../src/agent/goal/goal-gate';

const execFileAsync = promisify(execFile);

function okRun(): GateRunResult {
  return { ok: true, detail: 'exit 0' };
}

function failRun(detail = 'exit 1:\nFAIL src/foo.test.ts'): GateRunResult {
  return { ok: false, detail };
}

describe('auditGoalGate', () => {
  it('passes when the gate command exits 0', async () => {
    const { outcome, attempt } = await auditGoalGate(
      {
        command: 'npm run check',
        cwd: '/tmp/x',
        run: async () => okRun(),
        workspaceHash: async () => 'hash-a',
      },
      undefined,
    );
    expect(outcome.kind).toBe('passed');
    expect(attempt).toBeUndefined();
  });

  it('rejects with the bounded output tail when the gate fails', async () => {
    const { outcome, attempt } = await auditGoalGate(
      {
        command: 'npm run check',
        cwd: '/tmp/x',
        run: async () => failRun(),
        workspaceHash: async () => 'hash-a',
      },
      undefined,
    );
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.rejection.code).toBe('gate_failed');
    expect(outcome.rejection.reasons.join('\n')).toContain('npm run check');
    expect(outcome.rejection.reasons.join('\n')).toContain('FAIL src/foo.test.ts');
    expect(attempt?.result.ok).toBe(false);
    expect(attempt?.attempts).toBe(1);
  });

  it('replays the cached failure without re-running when the workspace is unchanged', async () => {
    let runs = 0;
    const options = {
      command: 'npm run check',
      cwd: '/tmp/x',
      run: async () => {
        runs += 1;
        return failRun();
      },
      workspaceHash: async () => 'hash-a',
    };
    const first = await auditGoalGate(options, undefined);
    expect(runs).toBe(1);

    const second = await auditGoalGate(options, first.attempt);
    expect(runs).toBe(1);
    expect(second.outcome.kind).toBe('failed');
    if (second.outcome.kind !== 'failed') return;
    expect(second.outcome.rejection.code).toBe('gate_failed');
    expect(second.outcome.rejection.reasons.join('\n')).toMatch(/unchanged since the last failed gate/i);
    expect(second.attempt?.attempts).toBe(2);
  });

  it('re-runs the gate once the workspace changes', async () => {
    let hash = 'hash-a';
    let runs = 0;
    const options = {
      command: 'npm run check',
      cwd: '/tmp/x',
      run: async () => {
        runs += 1;
        return runs === 1 ? failRun() : okRun();
      },
      workspaceHash: async () => hash,
    };
    const first = await auditGoalGate(options, undefined);
    hash = 'hash-b';
    const second = await auditGoalGate(options, first.attempt);
    expect(runs).toBe(2);
    expect(second.outcome.kind).toBe('passed');
    expect(second.attempt).toBeUndefined();
  });

  it('always runs the gate when no workspace hash is available (non-git cwd)', async () => {
    let runs = 0;
    const options = {
      command: 'npm run check',
      cwd: '/tmp/x',
      run: async () => {
        runs += 1;
        return failRun();
      },
      workspaceHash: async () => null,
    };
    const first = await auditGoalGate(options, undefined);
    await auditGoalGate(options, first.attempt);
    expect(runs).toBe(2);
  });

  it('drops the failure cache when the gate command changes', async () => {
    let runs = 0;
    const base = {
      cwd: '/tmp/x',
      run: async () => {
        runs += 1;
        return failRun();
      },
      workspaceHash: async () => 'hash-a',
    };
    const first = await auditGoalGate({ ...base, command: 'npm run check' }, undefined);
    const second = await auditGoalGate({ ...base, command: 'pnpm test' }, first.attempt);
    expect(runs).toBe(2);
    expect(second.attempt?.attempts).toBe(1);
  });

  it('reports gate_retry_exhausted once maxRetries is exceeded', async () => {
    let runs = 0;
    const options = {
      command: 'npm run check',
      cwd: '/tmp/x',
      maxRetries: 2,
      run: async () => {
        runs += 1;
        return failRun();
      },
      workspaceHash: async () => 'hash-a',
    };
    // attempt 1: real run, failed (1/2)
    const first = await auditGoalGate(options, undefined);
    expect(first.outcome.kind).toBe('failed');
    // attempt 2: cached replay, failed (2/2)
    const second = await auditGoalGate(options, first.attempt);
    expect(second.outcome.kind).toBe('failed');
    // attempt 3: cached replay, exhausted
    const third = await auditGoalGate(options, second.attempt);
    expect(runs).toBe(1);
    expect(third.outcome.kind).toBe('exhausted');
    if (third.outcome.kind !== 'exhausted') return;
    expect(third.outcome.rejection.code).toBe('gate_retry_exhausted');
    expect(third.outcome.rejection.nextActions.join('\n')).toMatch(/Stop attempting completion/i);
  });

  it('a pass after failures clears the cache so a later regression starts fresh', async () => {
    let hash = 'hash-a';
    let fail = true;
    const options = {
      command: 'npm run check',
      cwd: '/tmp/x',
      maxRetries: 1,
      run: async () => (fail ? failRun() : okRun()),
      workspaceHash: async () => hash,
    };
    const first = await auditGoalGate(options, undefined);
    expect(first.attempt?.attempts).toBe(1);
    fail = false;
    hash = 'hash-b';
    const second = await auditGoalGate(options, first.attempt);
    expect(second.outcome.kind).toBe('passed');
    fail = true;
    hash = 'hash-c';
    const third = await auditGoalGate(options, second.attempt);
    expect(third.outcome.kind).toBe('failed');
    expect(third.attempt?.attempts).toBe(1);
  });
});

describe('gitWorkspaceHash', () => {
  async function makeRepo(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'gate-hash-'));
    const git = (args: string[]) =>
      execFileAsync('git', ['--no-optional-locks', ...args], {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.test',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.test',
        },
      });
    await git(['init', '--initial-branch=main']);
    await writeFile(join(cwd, 'tracked.txt'), 'one\n');
    await git(['add', '.']);
    await git(['commit', '-m', 'init']);
    return cwd;
  }

  it('is null outside a git worktree', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'gate-nogit-'));
    expect(await gitWorkspaceHash(cwd)).toBeNull();
  });

  it('changes when an already-dirty tracked file is edited again', async () => {
    const cwd = await makeRepo();
    await writeFile(join(cwd, 'tracked.txt'), 'two\n');
    const first = await gitWorkspaceHash(cwd);
    // Porcelain output is identical here ('M tracked.txt' both times) — only
    // the diff component can tell these apart.
    await writeFile(join(cwd, 'tracked.txt'), 'three\n');
    const second = await gitWorkspaceHash(cwd);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('changes when an untracked file appears or grows', async () => {
    const cwd = await makeRepo();
    const before = await gitWorkspaceHash(cwd);
    await writeFile(join(cwd, 'new.ts'), 'export const a = 1;\n');
    const created = await gitWorkspaceHash(cwd);
    expect(created).not.toBe(before);
    await writeFile(join(cwd, 'new.ts'), 'export const a = 1;\nexport const b = 2;\n');
    const edited = await gitWorkspaceHash(cwd);
    expect(edited).not.toBe(created);
  });

  it('is stable when the workspace is untouched', async () => {
    const cwd = await makeRepo();
    await writeFile(join(cwd, 'tracked.txt'), 'dirty\n');
    const first = await gitWorkspaceHash(cwd);
    const second = await gitWorkspaceHash(cwd);
    expect(second).toBe(first);
  });
});
