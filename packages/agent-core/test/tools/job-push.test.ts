import { describe, expect, it, vi } from 'vitest';

import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import {
  dispatchPushRemote,
  evaluatePushTrust,
  pushJobToRemote,
  validatePushRefToken,
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
    });

    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.receipt?.sha).toBe('abcdef0123456789');
    expect(
      calls.some((c) => c[0] === 'push' && c[1] === 'origin' && c[2] === 'gh-pages:gh-pages'),
    ).toBe(true);
    expect(getJob(store, job.id)?.resultSummary).toMatch(/Pushed/);
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
