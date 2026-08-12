import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createJob,
  createJobId,
  emptyJobLedger,
  getJob,
  listJobs,
  patchJob,
  readJobLedger,
  writeJobLedger,
} from '../../src/tools/builtin/job/job-ledger';
import {
  listUnreadJobInbox,
  pushJobInboxEvent,
  readJobInbox,
} from '../../src/tools/builtin/job/job-inbox';
import {
  canStartMoreJobs,
  formatJobStripLine,
  nextQueuedJobs,
  resolveConductorPoolConfig,
  scheduleQueuedJobs,
  summarizeJobStrip,
  worktreeNameForJob,
} from '../../src/tools/builtin/job/job-runtime';
import {
  createConductorJobDraftRecorder,
  JobCreateTool,
  JobInboxTool,
  JobListTool,
  JobResumeTool,
  MergeJobTool,
} from '../../src/tools/builtin/job/job-tools';
import {
  CONDUCTOR_GUARD_CODES,
  ConductorDirectWorkGuard,
} from '../../src/agent/conductor-guard';
import { buildSubagentResultContract } from '../../src/session/subagent/subagent-result-contract';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import {
  interruptRunningJobs,
  jobPrompt,
  JOB_PRIOR_FINDINGS_MAX_CHARS,
  reconcileStaleRunningJobs,
  resumeJobs,
} from '../../src/tools/builtin/job/job-worker';
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

describe('job ledger', () => {
  it('creates job ids with job_ prefix', () => {
    expect(createJobId(1_700_000_000_000, () => 0.42)).toMatch(/^job_/);
  });

  it('creates and lists jobs with ACK-friendly state', async () => {
    const store = memoryStore();
    writeJobLedger(store, emptyJobLedger());
    const job = createJob(store, { title: 'fix footer flicker', kind: 'implement', priority: 2 });
    expect(job.status).toBe('queued');
    expect(job.id.startsWith('job_')).toBe(true);
    expect(listJobs(store)).toHaveLength(1);
    const updated = patchJob(store, job.id, { status: 'running' });
    expect(updated?.status).toBe('running');
    expect(readJobLedger(store).jobs[0]?.status).toBe('running');
  });

  it('JobCreate tool returns ACK and schedules without worktree when no agent', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'add job strip',
      success_criteria: ['job strip renders in the footer'],
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    expect(result.output).toMatch(/ACK job_/);
    // Without agent, requireWorktree=false path promotes to running
    expect(String(result.output)).toMatch(/state=running|state=queued/);
    const list = new JobListTool(store);
    const listExec = list.resolveExecution({});
    if (listExec.isError) return;
    const listed = await listExec.execute({
      turnId: 't',
      toolCallId: 'c2',
      signal: new AbortController().signal,
    });
    expect(listed.output).toContain('add job strip');
  });
});

describe('job runtime scheduler', () => {
  it('exposes locked pool defaults', () => {
    const cfg = resolveConductorPoolConfig({});
    expect(cfg.maxConcurrentJobs).toBe(6);
    expect(cfg.failTtlDays).toBe(7);
  });

  it('respects maxConcurrent when scheduling', async () => {
    const store = memoryStore();
    for (let i = 0; i < 8; i += 1) {
      createJob(store, { title: `job ${i}`, priority: i });
    }
    const first = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
    });
    expect(first.started).toHaveLength(6);
    expect(first.deferred).toBe(2);
    expect(first.backpressure).toBe(true);
    expect(canStartMoreJobs(store, 6)).toBe(false);
    expect(nextQueuedJobs(store, 10)).toHaveLength(2);

    // free one slot
    const running = listJobs(store).find((j) => j.status === 'running');
    expect(running).toBeDefined();
    patchJob(store, running!.id, { status: 'done' });
    const second = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
    });
    expect(second.started).toHaveLength(1);
    expect(canStartMoreJobs(store, 6)).toBe(false);
  });


  it('calls launchWorker after promoting job to running', async () => {
    const store = memoryStore();
    createJob(store, { title: 'spawn me', priority: 9 });
    const launched: string[] = [];
    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 2,
      requireWorktree: false,
      launchWorker: async (job) => {
        launched.push(job.id);
        patchJob(store, job.id, { workerAgentId: `agent_${job.id}` });
      },
    });
    expect(result.started).toHaveLength(1);
    expect(launched).toHaveLength(1);
    expect(result.started[0]?.workerAgentId).toBe(`agent_${launched[0]}`);
  });

  it('builds safe worktree names from job ids', () => {
    expect(worktreeNameForJob('job_abc123')).toMatch(/^conductor-j/);
  });

  it('blocks when worktree required but kaos missing', async () => {
    const store = memoryStore();
    createJob(store, { title: 'needs wt' });
    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: true,
      // kaos/repo missing
    });
    expect(result.started).toHaveLength(0);
    expect(result.blocked.length).toBeGreaterThan(0);
    expect(result.blocked[0]?.status).toBe('blocked');
  });

  it('assigns worktree via injected factory then runs', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'with wt', priority: 5 });
    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 2,
      requireWorktree: true,
      ensureGitRepo: false,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      createWorktree: async (_kaos, input) => ({
        workDir: `/tmp/worktrees/${input.name}`,
        meta: {
          path: `/tmp/worktrees/${input.name}`,
          branch: 'liora/x',
          repoRoot: '/tmp/repo',
          name: input.name,
          baseRef: 'HEAD',
          createdAt: new Date().toISOString(),
        },
        record: {
          name: input.name,
          path: `/tmp/worktrees/${input.name}`,
          repoRoot: '/tmp/repo',
          branch: 'liora/x',
          baseRef: 'HEAD',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      }),
    });
    expect(result.started).toHaveLength(1);
    const updated = listJobs(store).find((j) => j.id === job.id);
    expect(updated?.status).toBe('running');
    expect(updated?.worktreePath).toContain('/tmp/worktrees/');
    expect(updated?.worktreeBranch).toBe('liora/x');
  });

  it('defers a child job while its parent is still in flight', async () => {
    const store = memoryStore();
    const parent = createJob(store, { title: 'parent', priority: 5 });
    patchJob(store, parent.id, {
      status: 'running',
      worktreePath: '/tmp/worktrees/conductor-parent',
    });
    const child = createJob(store, { title: 'child fix', priority: 9, parentJobId: parent.id });

    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 3,
      requireWorktree: false,
    });

    expect(result.started).toHaveLength(0);
    expect(getJob(store, child.id)?.status).toBe('queued');
    expect(nextQueuedJobs(store, 10)).toHaveLength(0);
  });

  it('schedules goal-driver under a running goal-desk umbrella', async () => {
    const store = memoryStore();
    const desk = createJob(store, { title: 'Goal Desk', kind: 'goal-desk', priority: 10 });
    patchJob(store, desk.id, { status: 'running' });
    const driver = createJob(store, {
      title: 'Goal: ship',
      kind: 'goal-driver',
      priority: 11,
      parentJobId: desk.id,
    });

    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 3,
      requireWorktree: false,
    });

    expect(result.started.map((j) => j.id)).toContain(driver.id);
    expect(getJob(store, driver.id)?.status).toBe('running');
  });

  it('schedules verify while merge-trust blocked parent is held', async () => {
    const store = memoryStore();
    const impl = createJob(store, { title: 'Delete-pass', kind: 'implement', priority: 5 });
    patchJob(store, impl.id, {
      status: 'blocked',
      notes: 'merge: reject — verdict=missing',
      worktreePath: '/tmp/worktrees/conductor-delete-pass',
    });
    const verify = createJob(store, {
      title: 'Verify: Delete-pass',
      kind: 'verify',
      priority: 201,
      parentJobId: impl.id,
    });

    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
    });

    expect(result.started.map((j) => j.id)).toContain(verify.id);
    expect(getJob(store, verify.id)?.status).toBe('running');
    // Non-verify children still wait on a blocked parent.
    const fill = createJob(store, {
      title: 'Fill',
      kind: 'implement',
      priority: 9,
      parentJobId: impl.id,
    });
    expect(nextQueuedJobs(store, 10).map((j) => j.id)).not.toContain(fill.id);
  });

  it('chains a child job onto the parent worktree instead of a private branch', async () => {
    const store = memoryStore();
    const parent = createJob(store, { title: 'parent', priority: 5 });
    // Parent left the execution lane but has not landed yet — child reuses the
    // unmerged worktree (schedule defers while parent is still in-flight).
    patchJob(store, parent.id, {
      status: 'done',
      worktreePath: '/tmp/worktrees/conductor-parent',
    });
    const child = createJob(store, { title: 'child fix', priority: 5, parentJobId: parent.id });

    const createWorktree = vi.fn(async (_kaos: unknown, input: { name: string }) => ({
      workDir: `/tmp/worktrees/${input.name}`,
      meta: {
        path: `/tmp/worktrees/${input.name}`,
        branch: 'liora/x',
        repoRoot: '/tmp/repo',
        name: input.name,
        baseRef: 'HEAD',
        createdAt: new Date().toISOString(),
      },
      record: {
        name: input.name,
        path: `/tmp/worktrees/${input.name}`,
        repoRoot: '/tmp/repo',
        branch: 'liora/x',
        baseRef: 'HEAD',
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      },
    }));
    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 3,
      requireWorktree: true,
      ensureGitRepo: false,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      createWorktree: createWorktree as never,
    });

    expect(result.started).toHaveLength(1);
    expect(createWorktree).not.toHaveBeenCalled();
    const updated = getJob(store, child.id);
    expect(updated?.worktreePath).toBe('/tmp/worktrees/conductor-parent');
    expect(updated?.notes).toContain('chained onto parent');
  });

  it('gives the child its own worktree once the parent landed', async () => {
    const store = memoryStore();
    const parent = createJob(store, { title: 'parent landed', priority: 5 });
    patchJob(store, parent.id, {
      status: 'done',
      worktreePath: '/tmp/worktrees/conductor-parent',
      landReceipt: {
        mergeSha: 'abc123',
        branch: 'liora/conductor-parent',
        verifiedAt: new Date().toISOString(),
      },
    });
    const child = createJob(store, { title: 'late child', priority: 5, parentJobId: parent.id });

    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 3,
      requireWorktree: true,
      ensureGitRepo: false,
      kaos: {} as never,
      repoPath: '/tmp/repo',
      createWorktree: async (_kaos, input) => ({
        workDir: `/tmp/worktrees/${input.name}`,
        meta: {
          path: `/tmp/worktrees/${input.name}`,
          branch: 'liora/x',
          repoRoot: '/tmp/repo',
          name: input.name,
          baseRef: 'HEAD',
          createdAt: new Date().toISOString(),
        },
        record: {
          name: input.name,
          path: `/tmp/worktrees/${input.name}`,
          repoRoot: '/tmp/repo',
          branch: 'liora/x',
          baseRef: 'HEAD',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      }),
    });

    expect(result.started).toHaveLength(1);
    const updated = getJob(store, child.id);
    expect(updated?.worktreePath).not.toBe('/tmp/worktrees/conductor-parent');
    expect(updated?.worktreePath).toContain('/tmp/worktrees/conductor-');
  });
});

describe('job lanes + mission bind', () => {
  it('classifies interactive vs execution lanes', async () => {
    const { classifyConductorLane, isExecutionInFlight } = await import(
      '../../src/tools/builtin/job/job-lanes'
    );
    expect(classifyConductorLane({ text: 'What is Conductor?' }).lane).toBe('interactive');
    expect(
      classifyConductorLane({ text: 'Implement job strip footer and write tests' }).shouldCreateJob,
    ).toBe(true);
    expect(classifyConductorLane({ text: 'x', kind: 'mission' }).lane).toBe('execution');
    expect(isExecutionInFlight('running')).toBe(true);
    expect(isExecutionInFlight('done')).toBe(false);
  });

});

describe('merge trust + worker guards + warm pool', () => {
  it('evaluates merge trust rules', async () => {
    const { evaluateMergeTrust, pathIsDangerousForMerge } = await import(
      '../../src/tools/builtin/job/job-merge-trust'
    );
    expect(pathIsDangerousForMerge('.env.local')).toBe(true);
    expect(pathIsDangerousForMerge('src/foo.ts')).toBe(false);

    expect(
      evaluateMergeTrust({
        approve: true,
        checksGreen: true,
        hasConflict: false,
        diffLines: 40,
        hasSummary: true,
        paths: ['src/a.ts'],
      }).ok,
    ).toBe(true);

    expect(
      evaluateMergeTrust({
        approve: true,
        checksGreen: true,
        hasConflict: false,
        diffLines: 40,
        hasSummary: false,
        paths: ['src/a.ts'],
      }).ok,
    ).toBe(false);

    expect(
      evaluateMergeTrust({
        approve: true,
        checksGreen: true,
        hasConflict: false,
        diffLines: 40,
        hasSummary: true,
        paths: ['.env'],
      }).ok,
    ).toBe(false);

    const store = memoryStore();
    const created = createJob(store, {
      title: 'merge me',
      kind: 'implement',
      ownershipPaths: ['src/x.ts'],
      expertId: 'maker-ledger',
      surfaceKind: 'none',
    });
    patchJob(store, created.id, {
      status: 'done',
      resultContract: buildSubagentResultContract({
        agentId: 'agent_x',
        profile: 'coder',
        summary: 'done',
        filesChanged: ['src/x.ts'],
        verification: { tests: 'passed', typecheck: 'passed', lint: 'passed' },
      }),
    });
    const verify = createJob(store, {
      title: 'Verify: merge me',
      kind: 'verify',
      parentJobId: created.id,
      expertId: 'checker-ledger',
      surfaceKind: 'none',
    });
    patchJob(store, verify.id, {
      status: 'done',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
      verifyVerdict: 'passed',
    });
    const job = getJob(store, created.id)!;
    const tool = new MergeJobTool(store);
    const holdExec = tool.resolveExecution({
      job_id: job.id,
      approve: true,
      checks_green: true,
      has_conflict: false,
      diff_lines: 10,
      // no summary
    });
    if (holdExec.isError) throw new Error('resolve hold');
    const hold = await holdExec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(hold.isError).toBe(true);

    const okExec = tool.resolveExecution({
      job_id: job.id,
      approve: true,
      checks_green: true,
      has_conflict: false,
      diff_lines: 10,
      summary: 'small safe change',
      paths: ['src/x.ts'],
    });
    if (okExec.isError) throw new Error('resolve ok');
    const ok = await okExec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(ok.isError).toBe(false);
    expect(getJob(store, created.id)?.status).toBe('done');
  });

  it('blocks worker git push', async () => {
    const { guardWorkerShellCommand, isWorkerForbiddenGitRemoteCommand } = await import(
      '../../src/tools/builtin/job/job-worker-guards'
    );
    expect(isWorkerForbiddenGitRemoteCommand('git push origin HEAD')).toBe(true);
    expect(guardWorkerShellCommand('git push --force', { isWorker: true }).allowed).toBe(false);
    expect(guardWorkerShellCommand('git status', { isWorker: true }).allowed).toBe(true);
    expect(guardWorkerShellCommand('git push origin HEAD', { isWorker: false }).allowed).toBe(true);
  });
});

describe('job multi-intent split', () => {
  it('splits numbered lists and falls back to single', async () => {
    const { splitUserMessageIntoJobIntents } = await import(
      '../../src/tools/builtin/job/job-split'
    );
    const multi = splitUserMessageIntoJobIntents(
      '1. Fix footer flicker\n2. Add job strip\n3. Write tests',
    );
    expect(multi).toHaveLength(3);
    expect(multi[0]?.title).toMatch(/footer/i);

    const single = splitUserMessageIntoJobIntents('Just say hello');
    expect(single).toHaveLength(1);

    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'burst',
      prompt: '1. Alpha task here\n2. Beta task here\n3. Gamma task here',
      auto_split: true,
      success_criteria: ['each listed intent is completed and verified'],
    });
    if (exec.isError) throw new Error('resolve failed');
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(String(out.output)).toMatch(/ACK batch count=3/);
    expect(listJobs(store)).toHaveLength(3);
  });

  it('default staff path keeps a single explore brief as one job (no false 5-way split)', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'Explore: JobCreate multi-intent',
      kind: 'explore',
      // Mimic a coherent single-intent brief whose body contains success_criteria-style
      // numbered lines — the pre-fix staff fan-out treated these as 5 sibling jobs.
      prompt: [
        'Depends on explore sibling finding JobCreate multi-intent auto-split root cause.',
        '',
        '## User bug',
        'Single-intent JobCreate spawns 5 identical workers titled "(1)…(5)".',
        '',
        '## Fix goals',
        '1. Single clear intent MUST create exactly 1 job.',
        '2. auto_split only when prompt has truly independent multi-intents.',
        '3. Prefer: if ownership_paths empty + single goal sentence, never fanout.',
        '4. Do not break intentional multi-intent when user packs 3 independent asks.',
        '5. Add focused tests that reproduce false 5-way split.',
      ].join('\n'),
      success_criteria: [
        'Single-intent JobCreate no longer creates 5 sibling jobs in regression test',
        'Intentional multi-intent + auto_split still can create multiple when clearly multi',
        'Focused agent-core tests PASS via test-local',
        'Root cause documented in job result with file:line',
      ],
      // staff defaults true for explore — do not pass staff:false
    });
    if (exec.isError) throw new Error(`resolve failed: ${String(exec.output)}`);
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c-false-split',
      signal: new AbortController().signal,
    });
    expect(out.isError).toBe(false);
    expect(String(out.output)).not.toMatch(/ACK batch count=/);
    expect(listJobs(store)).toHaveLength(1);
    expect(listJobs(store)[0]?.title).toBe('Explore: JobCreate multi-intent');
  });

  it('auto_split still creates multiple jobs for independent numbered intents with default staff', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'Independent asks',
      kind: 'implement',
      prompt: '1. Fix login rate limit\n2. Add password reset email\n3. Write auth e2e tests',
      auto_split: true,
      success_criteria: ['each independent intent is completed and verified'],
    });
    if (exec.isError) throw new Error(`resolve failed: ${String(exec.output)}`);
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c-true-split',
      signal: new AbortController().signal,
    });
    expect(out.isError).toBe(false);
    expect(String(out.output)).toMatch(/ACK batch count=3 \(multi-intent split\)/);
    expect(listJobs(store)).toHaveLength(3);
  });
});

describe('job inbox + resume + strip', () => {
  it('pushes inbox events and JobInbox tool reads them', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'inbox me' });
    pushJobInboxEvent(store, {
      kind: 'job.completed',
      jobId: job.id,
      status: 'done',
      title: job.title,
      summary: 'ok',
    });
    expect(listUnreadJobInbox(store)).toHaveLength(1);
    expect(readJobInbox(store).schemaVersion).toBe(1);

    const tool = new JobInboxTool(store);
    const exec = tool.resolveExecution({ mark_read: true });
    if (exec.isError) throw new Error('resolve failed');
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(out.isError).toBe(false);
    expect(String(out.output)).toMatch(/job\.completed|inbox me/);
    expect(listUnreadJobInbox(store)).toHaveLength(0);
  });

  it('resumes interrupted jobs back to queued/running', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'resume me', priority: 3 });
    patchJob(store, job.id, { status: 'interrupted' });
    const result = await resumeJobs({ store, jobId: job.id });
    expect(result.ok).toBe(true);
    expect(result.resumed).toHaveLength(1);
    expect(listJobs(store)[0]?.status).toBe('queued');

    const tool = new JobResumeTool(store);
    patchJob(store, job.id, { status: 'interrupted' });
    const exec = tool.resolveExecution({});
    if (exec.isError) throw new Error('resolve failed');
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(out.isError).toBe(false);
    expect(String(out.output)).toMatch(/Resumed/);
  });

  it('marks running jobs interrupted and formats strip', () => {
    const store = memoryStore();
    const a = createJob(store, { title: 'a' });
    const b = createJob(store, { title: 'b' });
    patchJob(store, a.id, { status: 'running' });
    patchJob(store, b.id, { status: 'queued' });
    const interrupted = interruptRunningJobs({ store, reason: 'test disconnect' });
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]?.status).toBe('interrupted');
    expect(listJobs(store).find((j) => j.id === b.id)?.status).toBe('queued');

    const strip = summarizeJobStrip(store);
    expect(strip.interrupted).toBe(1);
    expect(strip.queued).toBe(1);
    expect(formatJobStripLine(strip, 2)).toMatch(/Jobs:/);
    expect(formatJobStripLine(strip, 2)).toMatch(/inbox 2/);
  });

  it('reconciles stale running jobs so resume can re-queue them', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'orphaned after crash' });
    patchJob(store, job.id, { status: 'running' });

    const reconciled = reconcileStaleRunningJobs({ store });
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.status).toBe('interrupted');
    expect(getJob(store, job.id)?.notes).toContain('process restarted');

    const before = await resumeJobs({ store, jobId: job.id });
    expect(before.ok).toBe(true);
    expect(before.resumed).toHaveLength(1);
    expect(getJob(store, job.id)?.status).toBe('queued');
  });
});

describe('worker context handoff', () => {
  it('renders context_paths and parent findings into the worker prompt', () => {
    const store = memoryStore();
    const parent = createJob(store, { title: 'explore auth', kind: 'explore' });
    patchJob(store, parent.id, {
      status: 'done',
      resultSummary: 'entry point is src/auth/session.ts',
    });
    const child = createJob(store, {
      title: 'fix auth race',
      kind: 'implement',
      prompt: 'Fix the token refresh race.',
      contextPaths: ['src/auth/session.ts', 'test/auth.test.ts'],
      parentJobId: parent.id,
      ownershipPaths: ['src/auth'],
    });

    const prompt = jobPrompt(child, store);
    expect(prompt).toContain('Read these first: src/auth/session.ts, test/auth.test.ts');
    expect(prompt).toContain(`Prior findings from parent job ${parent.id}:`);
    expect(prompt).toContain('entry point is src/auth/session.ts');
    // Read-first hints land before scope hints so the worker scans top-down.
    expect(prompt.indexOf('Read these first')).toBeLessThan(prompt.indexOf('Preferred paths'));
    expect(prompt).toContain('Worker contract:');
    expect(prompt).toContain('smallest diff that meets success criteria');
    expect(prompt).toContain('Final summary: what changed, how verified, what remains.');
  });

  it('caps parent findings at the handoff budget', () => {
    const store = memoryStore();
    const parent = createJob(store, { title: 'long explore' });
    patchJob(store, parent.id, {
      status: 'done',
      resultSummary: 'x'.repeat(JOB_PRIOR_FINDINGS_MAX_CHARS + 50),
    });
    const child = createJob(store, { title: 'child', parentJobId: parent.id });

    const prompt = jobPrompt(child, store);
    expect(prompt).toContain('[truncated]');
    expect(prompt).not.toContain('x'.repeat(JOB_PRIOR_FINDINGS_MAX_CHARS + 1));
  });

  it('persists needs_user answers onto the prompt so relaunched workers see them', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'needs answer', prompt: 'Original brief.' });
    patchJob(store, job.id, { status: 'needs_user' });

    const result = await resumeJobs({ store, jobId: job.id, answer: 'Use sqlite.' });
    expect(result.ok).toBe(true);
    const updated = getJob(store, job.id);
    expect(updated?.prompt).toContain('Original brief.');
    expect(updated?.prompt).toContain('[user-answer] Use sqlite.');
    expect(updated?.notes).toContain('user-answer: Use sqlite.');
    expect(jobPrompt(updated!, store)).toContain('[user-answer] Use sqlite.');
  });

  it('delivers context_paths and parent findings through JobCreate into the spawned prompt', async () => {
    const store = memoryStore();
    const parent = createJob(store, { title: 'explore first', kind: 'explore' });
    patchJob(store, parent.id, { status: 'done', resultSummary: 'race lives in refresh()' });

    const spawnedPrompts: string[] = [];
    const completion = new Promise<never>(() => {});
    const host = {
      spawn: async (options: { prompt: string; profileName?: string }) => {
        spawnedPrompts.push(options.prompt);
        return {
          agentId: 'agent_ctx',
          profileName: options.profileName ?? 'coder',
          resumed: false,
          completion,
        } as never;
      },
    };
    const agent = { subagentHost: host, config: { cwd: undefined } } as never;
    const tool = new JobCreateTool(store, agent);
    const exec = tool.resolveExecution({
      title: 'implement after explore',
      kind: 'implement',
      prompt: 'Fix the refresh race.',
      context_paths: ['src/auth/session.ts'],
      parent_job_id: parent.id,
      success_criteria: ['auth refresh race test passes'],
    });
    if (exec.isError) throw new Error('resolve failed');
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c_ctx',
      signal: new AbortController().signal,
    });
    expect(out.isError).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spawnedPrompts).toHaveLength(1);
    expect(spawnedPrompts[0]).toContain('Read these first: src/auth/session.ts');
    expect(spawnedPrompts[0]).toContain('race lives in refresh()');
  });

  it('marks jobs failed when the completion contract reports verification failure', async () => {
    const store = memoryStore();
    const contract = {
      agent_id: 'agent_vf',
      profile: 'coder',
      deviations: [],
      summary: 'implemented the fix',
      files_changed: ['src/auth/session.ts'],
      verification: { tests: 'failed', typecheck: 'passed', lint: 'not_run' },
      verification_failed: true,
    };
    let resolveCompletion!: (value: {
      result: string;
      contract: typeof contract;
    }) => void;
    const completion = new Promise<{ result: string; contract: typeof contract }>(
      (resolve) => {
        resolveCompletion = resolve;
      },
    );
    const host = {
      spawn: async (options: { prompt: string; profileName?: string }) => ({
        agentId: 'agent_vf',
        profileName: options.profileName ?? 'coder',
        resumed: false,
        completion,
      }),
    };
    const agent = { subagentHost: host, config: { cwd: undefined } } as never;
    const tool = new JobCreateTool(store, agent);
    const exec = tool.resolveExecution({
      title: 'risky change',
      kind: 'implement',
      success_criteria: ['focused checks pass for the change'],
    });
    if (exec.isError) throw new Error('resolve failed');
    await exec.execute({
      turnId: 't',
      toolCallId: 'c_vf',
      signal: new AbortController().signal,
    });
    resolveCompletion({ result: 'done\n<subagent-result>...</subagent-result>', contract });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const job = listJobs(store)[0];
    if (!job) throw new Error('job missing');
    expect(job.status).toBe('failed');
    expect(job.resultSummary).toContain('verification failed');
    expect(job.resultSummary).toContain('implemented the fix');
    expect(job.resultContract?.files_changed).toEqual(['src/auth/session.ts']);
  });

  it('propagates structured contract facts into child prior findings', () => {
    const store = memoryStore();
    const parent = createJob(store, { title: 'parent', kind: 'implement' });
    patchJob(store, parent.id, {
      status: 'done',
      resultSummary: 'done',
      resultContract: {
        agent_id: 'agent_p',
        profile: 'coder',
        deviations: [],
        summary: 'done',
        files_changed: ['src/a.ts', 'src/b.ts'],
        verification: { tests: 'passed', typecheck: 'passed', lint: 'not_run' },
        verification_failed: false,
      },
    });
    const child = createJob(store, { title: 'child', parentJobId: parent.id });

    const prompt = jobPrompt(child, store);
    expect(prompt).toContain('Files changed: src/a.ts, src/b.ts');
    expect(prompt).toContain('Verification: tests=passed, typecheck=passed, lint=not_run');
  });
});

describe('G2 demo scenario (evidence)', () => {
  it('runs 3 parallel jobs alongside a Mission-profile job while meta stays responsive', async () => {
    const store = memoryStore();

    // Planning job (kind=mission) on the ledger and running.
    const missionJob = createJob(store, {
      title: 'refactor harness loop',
      kind: 'mission',
    });
    patchJob(store, missionJob.id, { status: 'running' });

    // 3 parallel implementation jobs (burst).
    for (let i = 0; i < 3; i += 1) {
      createJob(store, { title: `demo parallel ${i + 1}`, priority: 3 - i, kind: 'implement' });
    }

    const result = await scheduleQueuedJobs({
      store,
      // locked default (CONDUCTOR_DEFAULT_MAX_CONCURRENT_JOBS = 6)
      maxConcurrent: 6,
      requireWorktree: false,
      launchWorker: async (job) => {
        patchJob(store, job.id, { workerAgentId: `worker_${job.id}` });
      },
    });
    expect(result.started).toHaveLength(3);
    expect(result.deferred).toBe(0);
    expect(result.backpressure).toBe(false);

    // Mission stays running and does not block the parallel set.
    const missionNow = getJob(store, missionJob.id);
    expect(missionNow?.status).toBe('running');

    // Meta stays responsive while workers run: inbox notices + ledger reads still work.
    const firstStarted = result.started[0];
    pushJobInboxEvent(store, {
      kind: 'job.completed',
      jobId: firstStarted!.id,
      status: 'done',
      title: firstStarted!.title,
      summary: 'demo parallel job completed',
    });
    expect(listUnreadJobInbox(store)).toHaveLength(1);
    expect(listJobs(store).filter((j) => j.status === 'running')).toHaveLength(4);
  });

  it('meta lane reads and clears a failure notice while another worker keeps running', async () => {
    const store = memoryStore();
    const a = createJob(store, { title: 'g2 worker A', kind: 'implement', priority: 2 });
    const b = createJob(store, { title: 'g2 worker B', kind: 'implement', priority: 1 });
    await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
      launchWorker: async (job) => {
        patchJob(store, job.id, { workerAgentId: `worker_${job.id}` });
      },
    });

    // B fails mid-flight (ownership conflict) while A keeps running.
    patchJob(store, b.id, { status: 'failed', resultSummary: 'ownership conflict' });
    pushJobInboxEvent(store, {
      kind: 'job.failed',
      jobId: b.id,
      status: 'failed',
      title: b.title,
      summary: 'ownership conflict',
    });

    // Meta lane stays responsive: read + mark_read without blocking on A.
    const inbox = new JobInboxTool(store);
    const exec = inbox.resolveExecution({ mark_read: true });
    if (exec.isError) throw new Error('resolve failed');
    const out = await exec.execute({
      turnId: 't',
      toolCallId: 'c_inbox',
      signal: new AbortController().signal,
    });
    const text = String(out.output);
    expect(text).toMatch(/job\.failed/);
    expect(text).toMatch(/Marked 1 event\(s\) read\./);
    // Post-mark strip must not carry a stale unread badge.
    expect(text).not.toMatch(/inbox \d+/);
    expect(listUnreadJobInbox(store)).toHaveLength(0);
    expect(getJob(store, a.id)?.status).toBe('running');

    // Second call: no unread left; the old notice is rendered as already read.
    const exec2 = inbox.resolveExecution({ mark_read: true });
    if (exec2.isError) throw new Error('resolve failed');
    const out2 = await exec2.execute({
      turnId: 't',
      toolCallId: 'c_inbox_2',
      signal: new AbortController().signal,
    });
    const text2 = String(out2.output);
    expect(text2).toMatch(/\[read\] job\.failed/);
    expect(text2).not.toMatch(/Marked/);
    expect(text2).not.toMatch(/inbox \d+/);
  });
});

describe('conductor non-blocking job path (regression)', () => {
  afterEach(() => {
    __resetJobWorkerHandlesForTests();
  });

  it('JobCreate ACK returns before worker completion; completion patches ledger + inbox', async () => {
    const store = memoryStore();
    let resolveCompletion!: (value: { result: string }) => void;
    const completion = new Promise<{ result: string }>((resolve) => {
      resolveCompletion = resolve;
    });
    const spawnProfiles: string[] = [];
    const host = {
      spawn: async (options: { prompt: string; profileName?: string }) => {
        spawnProfiles.push(options.profileName ?? '');
        return {
          agentId: 'agent_worker_ack',
          profileName: options.profileName ?? 'coder',
          resumed: false,
          completion,
        } as never;
      },
    };
    const agent = { subagentHost: host, config: { cwd: undefined } } as never;
    const tool = new JobCreateTool(store, agent);
    const exec = tool.resolveExecution({
      title: 'ack non-blocking',
      kind: 'implement',
      success_criteria: ['worker completes without blocking the ACK path'],
    });
    if (exec.isError) throw new Error('resolve failed');
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c_ack',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    const match = /ACK (job_\w+)/.exec(String(result.output));
    expect(match).not.toBeNull();
    const jobId = match![1]!;

    // ACK returned while the worker is still alive: no terminal state, no inbox.
    expect(spawnProfiles).toEqual(['coder']);
    expect(getJob(store, jobId)?.status).toBe('running');
    expect(getJob(store, jobId)?.workerAgentId).toBe('agent_worker_ack');
    expect(listUnreadJobInbox(store)).toHaveLength(0);

    // Worker completes later → fire-and-forget tail patches ledger + inbox.
    resolveCompletion({ result: 'worker summary' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getJob(store, jobId)?.status).toBe('done');
    // No result contract came back, so the completion carries no verification
    // evidence and the summary says so (P1-5).
    expect(getJob(store, jobId)?.resultSummary).toBe(
      'unverified (checks did not run) — worker summary',
    );
    const unread = listUnreadJobInbox(store);
    // Implement done → review-chain enqueue may add sibling inbox events.
    expect(
      unread.filter((entry) => entry.kind === 'job.completed' && entry.jobId === jobId),
    ).toHaveLength(1);
  });

  it('promotes queued jobs concurrently under maxConcurrent (launch handshakes do not serialize)', async () => {
    const store = memoryStore();
    for (let i = 0; i < 3; i += 1) {
      createJob(store, { title: `par ${i}`, priority: 3 - i });
    }
    let inFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = await scheduleQueuedJobs({
      store,
      maxConcurrent: 6,
      requireWorktree: false,
      launchWorker: async (job) => {
        inFlight += 1;
        // A serial scheduler deadlocks on the gate before the 3rd launch starts.
        if (inFlight < 3) await gate;
        else release();
        patchJob(store, job.id, { workerAgentId: `worker_${job.id}` });
      },
    });
    expect(result.started).toHaveLength(3);
    expect(inFlight).toBe(3);
  });

  it('interrupted → resume re-launches without awaiting worker completion', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'resume path', kind: 'implement' });
    patchJob(store, job.id, { status: 'running' });
    const interrupted = interruptRunningJobs({ store, reason: 'pause' });
    expect(interrupted).toHaveLength(1);
    expect(getJob(store, job.id)?.status).toBe('interrupted');

    // Worker that never settles in this test: resume must still return.
    const completion = new Promise<never>(() => {});
    const host = {
      spawn: async (options: { profileName?: string }) =>
        ({
          agentId: 'agent_resume',
          profileName: options.profileName ?? 'coder',
          resumed: false,
          completion,
        }) as never,
    };
    const agent = { subagentHost: host, config: { cwd: undefined } } as never;
    const result = await resumeJobs({ store, agent, jobId: job.id });
    expect(result.ok).toBe(true);
    expect(result.resumed).toHaveLength(1);
    // Pump promotes to running; worker attach is async on the spawner lane
    // (JobResume no longer awaits settle — Conductor hard-budget safety).
    expect(getJob(store, job.id)?.status).toBe('running');
    const { getJobWorkerSpawner } = await import('../../src/session/job/job-offload');
    await getJobWorkerSpawner().settle();
    expect(getJob(store, job.id)?.workerAgentId).toBe('agent_resume');
  });
});

describe('conductor guard draft recorder (V1-3)', () => {
  it('records a blocked-work draft as a queued Job and ACKs the job id', () => {
    const store = memoryStore();
    const recorder = createConductorJobDraftRecorder(store);

    const ack = recorder({
      draft: {
        title: 'Edit: src/auth.ts',
        prompt: 'Perform the work that was blocked on the Conductor lane.',
        ownership: 'worker',
      },
      code: CONDUCTOR_GUARD_CODES.directWorkBlocked,
      toolName: 'Edit',
      turnId: 'turn-1',
      violationCount: 2,
    });

    expect(ack?.jobId).toMatch(/^job_/);
    const job = getJob(store, ack?.jobId ?? '');
    expect(job).toBeDefined();
    expect(job?.status).toBe('queued');
    expect(job?.kind).toBe('implement');
    expect(job?.title).toBe('Edit: src/auth.ts');
    expect(job?.prompt).toContain('blocked on the Conductor lane');
    expect(job?.successCriteria?.length).toBeGreaterThan(0);
    expect(listJobs(store)).toHaveLength(1);
  });

  it('records explore-cap drafts as kind=explore and web tools as research', () => {
    const store = memoryStore();
    const explore = createConductorJobDraftRecorder(store)({
      draft: {
        title: 'Explore: auth module',
        prompt: 'Map auth flows',
        ownership: 'worker',
      },
      code: CONDUCTOR_GUARD_CODES.exploreSoft,
      toolName: 'Grep',
      turnId: 't-ex',
      violationCount: 1,
    });
    expect(getJob(store, explore?.jobId ?? '')?.kind).toBe('explore');

    const research = createConductorJobDraftRecorder(store)({
      draft: {
        title: 'Explore: WebSearch docs',
        prompt: 'Research API',
        ownership: 'worker',
      },
      code: CONDUCTOR_GUARD_CODES.exploreHard,
      toolName: 'WebSearch',
      turnId: 't-web',
      violationCount: 1,
    });
    expect(getJob(store, research?.jobId ?? '')?.kind).toBe('research');
  });

  it('escalates the second guard violation straight into the ledger', () => {
    const store = memoryStore();
    const guard = new ConductorDirectWorkGuard({
      recordJobDraft: createConductorJobDraftRecorder(store),
    });
    const call = {
      toolName: 'Write',
      args: { file_path: 'src/auth.ts' },
      turnId: 'turn-1',
    } as const;

    const first = guard.evaluateToolCall(call);
    expect(first.allowed).toBe(false);
    expect(listJobs(store)).toHaveLength(0);

    const second = guard.evaluateToolCall(call);
    expect(second.allowed).toBe(false);
    const jobs = listJobs(store);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('queued');
    expect(jobs[0]?.kind).toBe('implement');
    expect(jobs[0]?.title).toContain('Write');
    expect(jobs[0]?.title).toContain('src/auth.ts');
    if (!second.allowed) {
      // The rejection output ACKs the exact ledger entry.
      expect(second.output).toContain(jobs[0]?.id ?? '<missing>');
      expect(second.output).toContain('Recorded the blocked work as a queued Job');
    }
  });
});
