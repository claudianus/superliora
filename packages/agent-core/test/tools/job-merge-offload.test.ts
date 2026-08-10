import { describe, expect, it } from 'vitest';

import {
  buildSubagentResultContract,
  type SubagentResultContract,
} from '../../src/session/subagent/subagent-result-contract';
import { getJob, listJobs, createJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { MergeJobTool } from '../../src/tools/builtin/job/job-tools';
import type { Agent } from '../../src/agent';
import type { ToolStore } from '../../src/tools/store';

/**
 * V2-5 — merge offloading: verdict/execution split (checklist G5).
 *
 * MergeJob (interactive lane) evaluates trust (auto/hold) and returns the
 * verdict only. The actual `git merge` runs on a kind=merge landing job via
 * dispatchMergeLand (offload lane), never on the main turn. Contract:
 *
 * - with merge latency injected, the tool return time still meets the ACK
 *   deadline (250ms, contract §3.3 G1);
 * - the injected `git merge` call happens strictly AFTER the tool returned;
 * - hold verdicts never dispatch execution;
 * - the await-scan merge lane ratchet (0) covers the static path.
 */

/** Contract §3.3 G1 ACK deadline. */
const ACK_DEADLINE_MS = 250;
/** Injected merge latency — far beyond the ACK deadline. */
const MERGE_DELAY_MS = 60_000;

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

interface GitCall {
  readonly cwd: string;
  readonly args: readonly string[];
}

/** Auto-approve reads green off the ledger contract, not the tool arguments. */
function greenContract(filesChanged: readonly string[]): SubagentResultContract {
  return buildSubagentResultContract({
    agentId: 'agent_worker',
    profile: 'coder',
    summary: 'worker finished the task',
    filesChanged,
    verification: { tests: 'passed', typecheck: 'passed', lint: 'passed' },
  });
}

function finishedJobWithWorktree(store: ToolStore, title: string) {
  const job = createJob(store, {
    title,
    kind: 'implement',
    expertId: 'maker-test',
    surfaceKind: 'none',
  });
  const done = patchJob(store, job.id, {
    status: 'done',
    worktreePath: `/tmp/v2-5/${job.id}`,
    resultSummary: 'worker finished the task',
    resultContract: greenContract(['src/example.ts']),
  });
  if (!done) throw new Error('failed to prepare source job');
  // Maker≠Checker: MergeJob requires a passed independent verify child.
  const verify = createJob(store, {
    title: `Verify: ${title}`,
    kind: 'verify',
    parentJobId: done.id,
    expertId: 'checker-test',
    surfaceKind: 'none',
  });
  patchJob(store, verify.id, {
    status: 'done',
    resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
    verifyVerdict: 'passed',
  });
  return done;
}

async function until(
  predicate: () => boolean,
  attempts = 40,
  gapMs = 5,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  if (!predicate()) throw new Error('condition did not settle in time');
}

describe('V2-5 merge offloading (verdict/execution split)', () => {
  it(`returns the verdict within ${ACK_DEADLINE_MS}ms while the merge takes ${MERGE_DELAY_MS / 1000}s`, async () => {
    const store = memoryStore();
    const source = finishedJobWithWorktree(store, 'v2-5 source job');

    const gitCalls: GitCall[] = [];
    let mergeCompleted = false;
    let releaseMerge!: () => void;
    const mergeGate = new Promise<void>((resolve) => {
      releaseMerge = resolve;
    });
    const runGit = async (cwd: string, args: readonly string[]) => {
      gitCalls.push({ cwd, args });
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'job/v2-5-branch\n', stderr: '' };
      }
      if (args[0] === 'merge') {
        await mergeGate; // simulated slow merge (60s incident shape)
        mergeCompleted = true;
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const agent = { kaos: undefined, config: { cwd: '/repo/main' } } as never;
    const tool = new MergeJobTool(store, agent, { runGit });
    const exec = tool.resolveExecution({
      job_id: source.id,
      approve: true,
      summary: 'reviewed small fix',
      diff_lines: 12,
      has_conflict: false,
      checks_green: true,
      paths: ['src/example.ts'],
    });
    if (exec.isError) throw new Error('resolve failed');

    try {
      const startedAt = Date.now();
      const race = await Promise.race([
        exec
          .execute({ turnId: 't', toolCallId: 'c_merge', signal: new AbortController().signal })
          .then((result) => ({ kind: 'ack', result, elapsedMs: Date.now() - startedAt }) as const),
        new Promise<{ kind: 'deadline'; elapsedMs: number }>((resolve) => {
          const timer = setTimeout(
            () => resolve({ kind: 'deadline', elapsedMs: Date.now() - startedAt }),
            ACK_DEADLINE_MS,
          );
          timer.unref?.();
        }),
      ]);
      expect(
        race.kind,
        `MergeJob blocked on the merge for ${race.elapsedMs}ms (V2-5: verdict-only return)`,
      ).toBe('ack');
      if (race.kind !== 'ack') return;
      expect(race.elapsedMs).toBeLessThanOrEqual(ACK_DEADLINE_MS);

      const output = String(race.result.output);
      expect(race.result.isError).toBe(false);
      expect(output).toMatch(/ACK \S+ state=done/);
      expect(output).toContain('Merge approved (auto)');
      expect(output).toMatch(/landing worker job_\w+ \(kind=merge\)/);

      // The 60s merge gate is still held: whatever the offload lane already
      // started, NO merge completed during the interactive turn. The return
      // above (≤250ms against a 60s gate) is the non-blocking proof.
      expect(mergeCompleted).toBe(false);

      // The verdict is recorded; execution is tracked by a kind=merge job.
      expect(getJob(store, source.id)?.notes).toContain('merge: approved mode=auto');
      const mergeJobs = listJobs(store).filter((j) => j.kind === 'merge');
      expect(mergeJobs).toHaveLength(1);
      const mergeJob = mergeJobs[0]!;
      expect(mergeJob.parentJobId).toBe(source.id);
      expect(mergeJob.status).toBe('running');

      // Release the slow merge: execution completes off-turn and lands.
      releaseMerge();
      await until(() => getJob(store, mergeJob.id)?.status === 'done');

      expect(mergeCompleted, 'git merge completes only on the offload lane').toBe(true);
      const mergeCall = gitCalls.find((c) => c.args[0] === 'merge');
      expect(mergeCall?.cwd).toBe('/repo/main');
      expect(mergeCall?.args).toEqual(['merge', '--no-edit', 'job/v2-5-branch']);
      expect(getJob(store, mergeJob.id)?.resultSummary).toContain('Merged job/v2-5-branch');
      expect(getJob(store, source.id)?.status).toBe('done');
    } finally {
      releaseMerge();
    }
  });

  it('hold verdict returns immediately and dispatches no execution', async () => {
    const store = memoryStore();
    const source = finishedJobWithWorktree(store, 'v2-5 hold job');

    const gitCalls: GitCall[] = [];
    const runGit = async (cwd: string, args: readonly string[]) => {
      gitCalls.push({ cwd, args });
      return { code: 0, stdout: '', stderr: '' };
    };
    const agent = { kaos: undefined, config: { cwd: '/repo/main' } } as never;
    const tool = new MergeJobTool(store, agent, { runGit });
    const exec = tool.resolveExecution({
      job_id: source.id,
      approve: true,
      summary: 'reviewed',
      diff_lines: 12,
      checks_green: false, // trust rule: green is required
      paths: ['src/example.ts'],
    });
    if (exec.isError) throw new Error('resolve failed');

    const startedAt = Date.now();
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c_hold',
      signal: new AbortController().signal,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('Merge held (trust rules)');
    expect(elapsedMs).toBeLessThanOrEqual(ACK_DEADLINE_MS);
    // No execution: no landing job, no git invocation.
    expect(listJobs(store).filter((j) => j.kind === 'merge')).toHaveLength(0);
    expect(gitCalls).toHaveLength(0);
    expect(getJob(store, source.id)?.status).toBe('blocked');
    expect(getJob(store, source.id)?.notes).toContain('merge: hold');
  });

  it('approve=false rejects without dispatch', async () => {
    const store = memoryStore();
    const source = finishedJobWithWorktree(store, 'v2-5 reject job');
    const agent = { kaos: undefined, config: { cwd: '/repo/main' } } as never;
    const tool = new MergeJobTool(store, agent);
    const exec = tool.resolveExecution({ job_id: source.id, approve: false });
    if (exec.isError) throw new Error('resolve failed');

    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c_reject',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    expect(String(result.output)).toContain('Merge rejected/held.');
    expect(listJobs(store).filter((j) => j.kind === 'merge')).toHaveLength(0);
    expect(getJob(store, source.id)?.notes).toContain('merge: rejected');
  });

  it('approve without worktree lands ledger-only via the landing job', async () => {
    const store = memoryStore();
    const created = createJob(store, {
      title: 'v2-5 ledger-only',
      kind: 'implement',
      expertId: 'maker-ledger-only',
      surfaceKind: 'none',
    });
    const source = patchJob(store, created.id, {
      status: 'done',
      resultSummary: 'no worktree work',
      resultContract: greenContract(['docs/example.md']),
    });
    if (!source) throw new Error('failed to prepare source job');
    const verify = createJob(store, {
      title: 'Verify: v2-5 ledger-only',
      kind: 'verify',
      parentJobId: source.id,
      expertId: 'checker-ledger-only',
      surfaceKind: 'none',
    });
    patchJob(store, verify.id, {
      status: 'done',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
      verifyVerdict: 'passed',
    });

    const agent = { kaos: undefined, config: { cwd: '/repo/main' } } as never;
    const tool = new MergeJobTool(store, agent);
    const exec = tool.resolveExecution({
      job_id: source.id,
      approve: true,
      summary: 'reviewed ledger-only',
      diff_lines: 3,
      checks_green: true,
      paths: ['docs/example.md'],
    });
    if (exec.isError) throw new Error('resolve failed');

    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c_ledger_only',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    const mergeJob = listJobs(store).find((j) => j.kind === 'merge');
    expect(mergeJob).toBeDefined();
    await until(() => getJob(store, mergeJob!.id)?.status === 'done');
    expect(getJob(store, mergeJob!.id)?.resultSummary).toContain('ledger only');
    expect(getJob(store, source.id)?.status).toBe('done');
  });

  it('auto permission waives dangerous-path confirm without a human click', async () => {
    const store = memoryStore();
    const created = createJob(store, {
      title: 'auto land dangerous',
      kind: 'implement',
      expertId: 'maker-danger',
      surfaceKind: 'none',
    });
    const source = patchJob(store, created.id, {
      status: 'done',
      resultSummary: 'touched env example',
      resultContract: greenContract(['src/x.ts', '.env']),
    });
    if (!source) throw new Error('failed to prepare source job');
    const verify = createJob(store, {
      title: 'Verify: auto land dangerous',
      kind: 'verify',
      parentJobId: source.id,
      expertId: 'checker-danger',
      surfaceKind: 'none',
    });
    patchJob(store, verify.id, {
      status: 'done',
      resultSummary: '{"verdict":"pass","findings":[],"required_fixes":[]}',
      verifyVerdict: 'passed',
    });

    const manual = new MergeJobTool(store, {
      permission: { mode: 'manual' },
      kaos: undefined,
      config: { cwd: '/repo/main' },
    } as unknown as Agent);
    const manualExec = manual.resolveExecution({
      job_id: source.id,
      approve: true,
      summary: 'reviewed',
      diff_lines: 8,
      checks_green: true,
      paths: ['src/x.ts', '.env'],
    });
    if (manualExec.isError) throw new Error('resolve manual');
    const manualResult = await manualExec.execute({
      turnId: 't',
      toolCallId: 'c_manual',
      signal: new AbortController().signal,
    });
    expect(manualResult.isError).toBe(true);
    expect(String(manualResult.output)).toMatch(/Dangerous paths/);

    const auto = new MergeJobTool(store, {
      permission: { mode: 'auto' },
      kaos: undefined,
      config: { cwd: '/repo/main' },
    } as unknown as Agent);
    const autoExec = auto.resolveExecution({
      job_id: source.id,
      approve: true,
      summary: 'reviewed',
      diff_lines: 8,
      checks_green: true,
      paths: ['src/x.ts', '.env'],
    });
    if (autoExec.isError) throw new Error('resolve auto');
    const autoResult = await autoExec.execute({
      turnId: 't',
      toolCallId: 'c_auto',
      signal: new AbortController().signal,
    });
    expect(autoResult.isError).toBe(false);
    expect(String(autoResult.output)).toContain('Merge approved (auto)');
  });
});
