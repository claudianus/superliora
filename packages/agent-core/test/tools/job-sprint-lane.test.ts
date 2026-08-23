/**
 * Conductor sprint waist: default none-surface auto-land, synthesized briefs,
 * affinity=auto, hotfix skip-worktree.
 */

import { describe, expect, it } from 'vitest';

import { onJobTerminalForVerifyChain } from '../../src/tools/builtin/job/job-verify-chain';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { JobCreateTool } from '../../src/tools/builtin/job/job-tools';
import { needsWorktree, scheduleQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
import { setConductorProjectModeMaxConcurrent } from '../../src/tools/builtin/job/job-project-mode';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      return data[key] as never;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

function countingWorktreeFactory(created: string[]) {
  return async (_kaos: unknown, input: { readonly name: string }) => {
    created.push(input.name);
    return { workDir: `/tmp/wt/${input.name}`, branch: `job/${input.name}` };
  };
}

async function runCreate(
  store: ToolStore,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; output: string }> {
  const tool = new JobCreateTool(store);
  const exec = tool.resolveExecution(args as never);
  if (exec.isError === true) {
    return { isError: true, output: String(exec.output) };
  }
  const result = await exec.execute!({
    turnId: 't',
    toolCallId: 'c',
    signal: new AbortController().signal,
  });
  return { isError: result.isError, output: String(result.output) };
}

describe('coding Job create defaults', () => {
  it('stores surfaceKind=none when omitted', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Fix parser',
      kind: 'implement',
      ownershipPaths: ['src/parse.ts'],
    });
    expect(job.surfaceKind).toBe('none');
    expect(job.deliveryClass).toBeUndefined();
  });

  it('synthesizes success_criteria when JobCreate omits them', async () => {
    const store = memoryStore();
    const out = await runCreate(store, {
      title: 'Fix parser',
      kind: 'implement',
      ownership_paths: ['src/parse.ts'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    const job = listJobs(store)[0]!;
    expect(job.successCriteria?.length).toBeGreaterThan(0);
    expect(job.successCriteria?.[0]).toMatch(/Fix parser is complete/i);
    expect(job.surfaceKind).toBe('none');
  });

  it('stamps deliveryClass=sprint from hotfix project mode', async () => {
    const store = memoryStore();
    setConductorProjectModeMaxConcurrent(store, 'hotfix');
    const out = await runCreate(store, {
      title: 'Hotfix parser',
      kind: 'implement',
      ownership_paths: ['src/parse.ts'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(listJobs(store)[0]?.deliveryClass).toBe('sprint');
  });

  it('stamps deliveryClass=review from review project mode', async () => {
    const store = memoryStore();
    setConductorProjectModeMaxConcurrent(store, 'review');
    const out = await runCreate(store, {
      title: 'Review parser',
      kind: 'implement',
      ownership_paths: ['src/parse.ts'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(listJobs(store)[0]?.deliveryClass).toBe('review');
  });
});

describe('affinity default auto', () => {
  it('steers a live overlapping Job without affinity=auto in the args', async () => {
    const store = memoryStore();
    const live = createJob(store, {
      title: 'Live owner',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
      successCriteria: ['ok'],
    });
    patchJob(store, live.id, { status: 'running' });
    const out = await runCreate(store, {
      title: 'Follow-up',
      kind: 'implement',
      ownership_paths: ['packages/foo'],
      prompt: 'same area tweak',
      success_criteria: ['ok', 'tweak done'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(out.output).toMatch(/affinity: steer/);
    expect(listJobs(store)).toHaveLength(1);
    expect(listJobs(store)[0]!.id).toBe(live.id);
  });
});

describe('none-surface auto-land', () => {
  it('does not auto-land when worker checks never ran', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Unverified fix',
      kind: 'implement',
      expertId: 'maker-x',
      ownershipPaths: ['src/a.ts'],
      surfaceKind: 'none',
    });
    patchJob(store, parent.id, {
      status: 'done',
      resultSummary: 'applied the patch',
      resultContract: {
        agent_id: 'agent_1',
        profile: 'coder',
        status: 'completed',
        summary: 'applied the patch',
        files_changed: ['src/a.ts'],
        verification: { tests: 'not_run', typecheck: 'not_run', lint: 'not_run' },
        verification_failed: false,
        deviations: [],
      },
    });
    await onJobTerminalForVerifyChain(store, getJob(store, parent.id)!);
    expect(listJobs(store).filter((j) => j.kind === 'merge')).toHaveLength(0);
  });

  it('dispatches merge on implement done without a verify child', async () => {
    const store = memoryStore();
    const parent = createJob(store, {
      title: 'Tiny fix',
      kind: 'implement',
      expertId: 'maker-x',
      ownershipPaths: ['src/a.ts'],
      surfaceKind: 'none',
    });
    patchJob(store, parent.id, { status: 'done', resultSummary: 'fixed' });
    await onJobTerminalForVerifyChain(store, getJob(store, parent.id)!);
    expect(listJobs(store).filter((j) => j.kind === 'verify')).toHaveLength(0);
    const mergeJobs = listJobs(store).filter((j) => j.kind === 'merge' && j.parentJobId === parent.id);
    expect(mergeJobs).toHaveLength(1);
  });
});

describe('hotfix sprint worktree skip', () => {
  it('skips worktree when no other coding Job is in flight', async () => {
    const created: string[] = [];
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Sprint fix',
      kind: 'implement',
      deliveryClass: 'sprint',
      ownershipPaths: ['src/a.ts'],
    });
    expect(needsWorktree(job, store)).toBe(false);
    const result = await scheduleQueuedJobs({
      store,
      kaos: {} as never,
      repoPath: '/repo',
      createWorktree: countingWorktreeFactory(created) as never,
      ensureGitRepo: false,
    });
    expect(result.started).toHaveLength(1);
    expect(created).toEqual([]);
    expect(getJob(store, job.id)?.worktreePath).toBeUndefined();
  });

  it('creates a worktree when another coding Job is already running', async () => {
    const created: string[] = [];
    const store = memoryStore();
    const live = createJob(store, {
      title: 'Live',
      kind: 'implement',
      ownershipPaths: ['src/b.ts'],
    });
    patchJob(store, live.id, { status: 'running' });
    const job = createJob(store, {
      title: 'Sprint second',
      kind: 'implement',
      deliveryClass: 'sprint',
      ownershipPaths: ['src/a.ts'],
    });
    expect(needsWorktree(job, store)).toBe(true);
    const result = await scheduleQueuedJobs({
      store,
      kaos: {} as never,
      repoPath: '/repo',
      createWorktree: countingWorktreeFactory(created) as never,
      ensureGitRepo: false,
    });
    expect(result.started).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(getJob(store, job.id)?.worktreePath).toBeDefined();
  });
});
