/**
 * Conductor Job worker affinity — steer / fold / reuse + auto hint.
 */

import { describe, expect, it } from 'vitest';

import {
  findAffinityAnchor,
  findAffinityHint,
  formatAffinityHint,
  resolveJobAffinity,
  reuseInheritanceFromAnchor,
} from '../../src/tools/builtin/job/job-affinity';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { JobCreateTool } from '../../src/tools/builtin/job/job-tools';
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

describe('resolveJobAffinity', () => {
  it('steers a running affinity-eligible Job', () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'Fix auth',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
      successCriteria: ['tests pass'],
    });
    patchJob(store, anchor.id, { status: 'running' });
    const d = resolveJobAffinity(store, {
      continueFromJobId: anchor.id,
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    expect(d).toEqual({ action: 'steer', anchor: expect.objectContaining({ id: anchor.id }) });
  });

  it('folds a queued Job', () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'Fix auth',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    const d = resolveJobAffinity(store, {
      continueFromJobId: anchor.id,
      kind: 'implement',
    });
    expect(d?.action).toBe('fold');
  });

  it('reattaches a done unlanded coding Job instead of spawning a child', () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'Fix auth',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
      worktreePath: '/tmp/wt-auth',
      workerResumeAgentId: 'agent_abc',
    });
    patchJob(store, anchor.id, { status: 'done', worktreePath: '/tmp/wt-auth' });
    const d = resolveJobAffinity(store, {
      continueFromJobId: anchor.id,
      kind: 'implement',
    });
    expect(d?.action).toBe('reattach');
    if (d?.action !== 'reattach') return;
    expect(d.anchor.worktreePath).toBe('/tmp/wt-auth');
    expect(d.anchor.workerResumeAgentId).toBe('agent_abc');
  });

  it('rejects verify / auto_split / landed anchors', () => {
    const store = memoryStore();
    const coding = createJob(store, {
      title: 'Fix auth',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    patchJob(store, coding.id, {
      status: 'done',
      landReceipt: {
        mergeSha: 'abc',
        branch: 'liora/x',
        verifiedAt: new Date().toISOString(),
      },
    });
    expect(
      resolveJobAffinity(store, {
        continueFromJobId: coding.id,
        kind: 'implement',
      })?.action,
    ).toBe('reject');
    expect(
      resolveJobAffinity(store, {
        continueFromJobId: coding.id,
        kind: 'verify',
      })?.action,
    ).toBe('reject');
    expect(
      resolveJobAffinity(store, {
        continueFromJobId: coding.id,
        kind: 'implement',
        autoSplit: true,
      })?.action,
    ).toBe('reject');
  });

  it('reuses a terminal mission into implement (plan→code continuity)', () => {
    const store = memoryStore();
    const mission = createJob(store, {
      title: 'Plan coding/general',
      kind: 'mission',
      ownershipPaths: ['packages/agent-core'],
      worktreePath: '/tmp/wt-plan',
      worktreeBranch: 'liora/plan-x',
      workerResumeAgentId: 'agent_plan',
      workerCheckpointAt: '2026-08-17T00:00:00.000Z',
    });
    patchJob(store, mission.id, {
      status: 'done',
      worktreePath: '/tmp/wt-plan',
      resultSummary: 'Plan approved; implement next.',
    });
    const d = resolveJobAffinity(store, {
      continueFromJobId: mission.id,
      kind: 'implement',
    });
    expect(d?.action).toBe('reuse');
    if (d?.action !== 'reuse') return;
    const inherit = reuseInheritanceFromAnchor(d.anchor);
    expect(inherit.worktreePath).toBe('/tmp/wt-plan');
    expect(inherit.workerResumeAgentId).toBe('agent_plan');
    expect(inherit.parentJobId).toBe(mission.id);
  });

  it('rejects live mission and mission→explore continue_from', () => {
    const store = memoryStore();
    const mission = createJob(store, {
      title: 'Plan still open',
      kind: 'mission',
      ownershipPaths: ['packages/agent-core'],
    });
    patchJob(store, mission.id, { status: 'running' });
    expect(
      resolveJobAffinity(store, {
        continueFromJobId: mission.id,
        kind: 'implement',
      })?.action,
    ).toBe('reject');
    patchJob(store, mission.id, { status: 'done' });
    expect(
      resolveJobAffinity(store, {
        continueFromJobId: mission.id,
        kind: 'explore',
      })?.action,
    ).toBe('reject');
    expect(
      resolveJobAffinity(store, {
        continueFromJobId: mission.id,
        kind: 'verify',
      })?.action,
    ).toBe('reject');
  });
});

describe('affinity=auto selection', () => {
  it('prefers live overlapping owners over queued/terminal', () => {
    const store = memoryStore();
    const done = createJob(store, {
      title: 'old',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    patchJob(store, done.id, { status: 'done' });
    const queued = createJob(store, {
      title: 'queued',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    const live = createJob(store, {
      title: 'live',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    patchJob(store, live.id, { status: 'running' });
    expect(queued.status).toBe('queued');
    const anchor = findAffinityAnchor(store, {
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    expect(anchor?.id).toBe(live.id);
  });

  it('ranks a resumable same-kind job above a newer sibling within a tier', () => {
    const store = memoryStore();
    // Created first (older) but a strictly better context match: same kind and
    // a live resume checkpoint worth +2, beating the newer sibling.
    const resumable = createJob(store, {
      title: 'older resumable',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
      workerResumeAgentId: 'agent_warm',
    });
    const newer = createJob(store, {
      title: 'newer sibling',
      kind: 'explore',
      ownershipPaths: ['packages/foo'],
    });
    expect(newer.updatedAt.localeCompare(resumable.updatedAt)).toBeGreaterThanOrEqual(0);

    const anchor = findAffinityAnchor(store, {
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    expect(anchor?.id).toBe(resumable.id);
  });

  it('scores context-path overlap into the anchor choice', () => {
    const store = memoryStore();
    const withContext = createJob(store, {
      title: 'shares context paths',
      kind: 'explore',
      ownershipPaths: ['packages/foo'],
      contextPaths: ['docs/design.md'],
    });
    const other = createJob(store, {
      title: 'no shared context',
      kind: 'explore',
      ownershipPaths: ['packages/foo'],
    });
    // Both are fresh, same-kind, no resume — context overlap is the decider.
    const anchor = findAffinityAnchor(store, {
      kind: 'explore',
      ownershipPaths: ['packages/foo'],
      contextPaths: ['docs/design.md'],
    });
    expect(anchor?.id).toBe(withContext.id);
    expect(anchor?.id).not.toBe(other.id);
  });
});

describe('formatAffinityHint scoring suffix', () => {
  it('appends score and reasons when scoring input is given', () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'hint me',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
      workerResumeAgentId: 'agent_warm',
    });
    const hint = formatAffinityHint(
      getJob(store, anchor.id)!,
      { kind: 'implement', ownershipPaths: ['packages/foo'] },
    );
    expect(hint).toMatch(new RegExp(`^affinity_hint: ${anchor.id}`));
    expect(hint).toMatch(/score=\d+/);
    expect(hint).toMatch(/paths=1/);
    expect(hint).toMatch(/resume=agent_warm/);
  });

  it('stays score-free without scoring input', () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'plain hint',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
    });
    const hint = formatAffinityHint(getJob(store, anchor.id)!);
    expect(hint).toMatch(new RegExp(`^affinity_hint: ${anchor.id}`));
    expect(hint).not.toMatch(/score=/);
  });
});

describe('JobCreate affinity integration', () => {
  it('folds continue_from into a queued Job without creating a sibling', async () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'Fix flicker',
      kind: 'implement',
      prompt: 'original',
      ownershipPaths: ['apps/liora/src/tui'],
      successCriteria: ['smoke green'],
    });
    const out = await runCreate(store, {
      title: 'Also fix scroll jank',
      kind: 'implement',
      continue_from_job_id: anchor.id,
      prompt: 'user: scroll jank on the same panel',
      ownership_paths: ['apps/liora/src/tui'],
      success_criteria: ['smoke green', 'scroll feels stable'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(out.output).toMatch(/session: fold/);
    expect(listJobs(store)).toHaveLength(1);
    const job = listJobs(store)[0]!;
    expect(job.id).toBe(anchor.id);
    expect(job.title).toBe('Also fix scroll jank');
    expect(job.prompt).toMatch(/affinity/);
    expect(job.successCriteria).toEqual(['smoke green', 'scroll feels stable']);
  });

  it('reattaches a done unlanded coding Job onto the same id', async () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'Fix flicker',
      kind: 'implement',
      ownershipPaths: ['apps/liora/src/tui'],
      successCriteria: ['smoke green'],
      worktreePath: '/tmp/wt-flicker',
      worktreeBranch: 'liora/flicker',
      workerResumeAgentId: 'agent_resume_1',
      workerCheckpointAt: '2026-08-11T00:00:00.000Z',
    });
    patchJob(store, anchor.id, {
      status: 'done',
      worktreePath: '/tmp/wt-flicker',
      worktreeBranch: 'liora/flicker',
      workerResumeAgentId: 'agent_resume_1',
    });
    const out = await runCreate(store, {
      title: 'Fix-forward from review',
      kind: 'implement',
      continue_from_job_id: anchor.id,
      prompt: 'address review comments',
      success_criteria: ['review findings closed'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(out.output).toMatch(/session: reattach/);
    const jobs = listJobs(store);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(anchor.id);
    expect(jobs[0]!.worktreePath).toBe('/tmp/wt-flicker');
    expect(jobs[0]!.workerResumeAgentId).toBe('agent_resume_1');
    expect(['queued', 'running', 'blocked']).toContain(jobs[0]!.status);
  });

  it('steers a running Job via continue_from (same job id)', async () => {
    const store = memoryStore();
    const anchor = createJob(store, {
      title: 'Fix flicker',
      kind: 'implement',
      ownershipPaths: ['apps/liora/src/tui'],
      successCriteria: ['smoke green'],
    });
    patchJob(store, anchor.id, { status: 'running', workerAgentId: 'agent_live' });
    const out = await runCreate(store, {
      title: 'Also cover empty state',
      kind: 'implement',
      continue_from_job_id: anchor.id,
      prompt: 'empty state should not flash',
      success_criteria: ['smoke green', 'empty state stable'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(out.output).toMatch(/session: steer/);
    expect(listJobs(store)).toHaveLength(1);
    expect(listJobs(store)[0]!.successCriteria).toEqual([
      'smoke green',
      'empty state stable',
    ]);
  });

  it('emits affinity_hint when a cold create overlaps a live owner', async () => {
    const store = memoryStore();
    const live = createJob(store, {
      title: 'Live owner',
      kind: 'implement',
      ownershipPaths: ['packages/agent-core/src/tools'],
      successCriteria: ['ok'],
    });
    patchJob(store, live.id, { status: 'running' });
    const out = await runCreate(store, {
      title: 'Cold sibling',
      kind: 'implement',
      affinity: 'off',
      ownership_paths: ['packages/agent-core/src/tools'],
      success_criteria: ['also ok'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(out.output).toMatch(new RegExp(`affinity_hint: ${live.id}`));
    expect(listJobs(store)).toHaveLength(2);
    expect(formatAffinityHint(findAffinityHint(store, {
      ownershipPaths: ['packages/agent-core/src/tools'],
      excludeJobIds: new Set(
        listJobs(store).filter((j) => j.id !== live.id).map((j) => j.id),
      ),
    })!)).toMatch(/JobSteer/);
  });

  it('affinity=auto steers the live overlapping Job', async () => {
    const store = memoryStore();
    const live = createJob(store, {
      title: 'Live owner',
      kind: 'implement',
      ownershipPaths: ['packages/foo'],
      successCriteria: ['ok'],
    });
    patchJob(store, live.id, { status: 'running' });
    const out = await runCreate(store, {
      title: 'Auto follow-up',
      kind: 'implement',
      affinity: 'auto',
      ownership_paths: ['packages/foo'],
      prompt: 'same area tweak',
      success_criteria: ['ok', 'tweak done'],
      staff: false,
    });
    expect(out.isError).toBeFalsy();
    expect(out.output).toMatch(/session: steer/);
    expect(listJobs(store)).toHaveLength(1);
    expect(listJobs(store)[0]!.id).toBe(live.id);
  });
});
