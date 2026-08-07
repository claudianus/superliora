import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { getJobWorkerSpawner } from '../../src/session/job/job-offload';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import {
  JobCreateTool,
  JobInspectTool,
  JobListTool,
  JobSteerTool,
  MergeJobTool,
} from '../../src/tools/builtin/job/job-tools';
import { launchJobWorker } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';

/**
 * V2-6 — live-demo instrumentation: main-turn wall clock under 3 concurrent
 * workers (checklist V2-6, contract §3.3).
 *
 * Procedure (the measurement harness below):
 *   1. launch 3 job workers with staged async work (~250ms each) so they are
 *      genuinely in flight during the measurement window;
 *   2. while the workers run, execute representative interactive-lane tools
 *      (JobCreate / JobList / JobInspect / JobSteer / MergeJob verdict) and
 *      wall-clock each call;
 *   3. assert the per-op maximum ≤ 3000ms and emit the instrumentation log.
 *
 * The instrumentation log is written to `reports/` when
 * SUPERLIORA_V2_6_REPORT=1 (committed evidence is generated that way):
 *
 *   SUPERLIORA_V2_6_REPORT=1 pnpm -C packages/agent-core exec vitest run \
 *     test/tools/job-main-turn-instrumentation.test.ts
 *
 * Without the flag the same numbers are printed to the test output.
 */

const MAIN_TURN_BUDGET_MS = 3_000;

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

/** Synchronous CPU burn — real event-loop pressure for the measured ops. */
function busy(ms: number): void {
  const end = Date.now() + ms;
  let acc = 0;
  while (Date.now() < end) acc += 1;
  void acc;
}

/** Staged worker work: alternating timer waits and CPU burns. */
async function stagedWorkerWork(
  chunks: number,
  chunkDelayMs: number,
  busyMs: number,
): Promise<string> {
  for (let i = 0; i < chunks; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
    busy(busyMs);
  }
  return 'worker done';
}

async function until(predicate: () => boolean, attempts = 120, gapMs = 5): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  if (!predicate()) throw new Error('condition did not settle in time');
}

interface OpSample {
  readonly op: string;
  readonly target: string;
  readonly elapsedMs: number;
  readonly workersActive: number;
}

describe('V2-6 main-turn instrumentation under 3 concurrent workers', () => {
  afterEach(() => {
    __resetJobWorkerHandlesForTests();
  });

  it(`main-turn wall-clock max stays within ${MAIN_TURN_BUDGET_MS}ms`, async () => {
    const store = memoryStore();
    let demoCompletions = 0;
    let bgSpawnSeq = 0;

    // Fake FanoutHost: spawned bg workers do short staged work.
    const host = {
      spawn: async (options: { runId: string }) => {
        bgSpawnSeq += 1;
        const completion = stagedWorkerWork(8, 5, 1).then((result) => ({ result }));
        return {
          agentId: `agent_bg_${options.runId ?? `seq${bgSpawnSeq}`}`,
          profileName: 'coder',
          resumed: false,
          completion,
        };
      },
    };
    const agent = {
      subagentHost: host,
      config: { cwd: undefined },
      kaos: undefined,
      sessionContext: undefined,
      toolPolicyContext: undefined,
    } as never;

    // --- 1) launch 3 concurrent demo workers (~250ms staged work each) ---
    const demoJobIds: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const job = createJob(store, { title: `v2-6 demo worker ${i}`, kind: 'implement' });
      const running = patchJob(store, job.id, {
        status: 'running',
        worktreePath: `/tmp/v2-6/demo-${i}`,
      });
      if (!running) throw new Error('failed to promote demo job');
      demoJobIds.push(job.id);
      const completion = stagedWorkerWork(24, 8, 2).then((result) => {
        demoCompletions += 1;
        return { result };
      });
      const spawnOne = (async () => ({
        agentId: `agent_demo_${i}`,
        profileName: 'coder',
        resumed: false,
        completion,
      })) as never;
      const launched = await launchJobWorker({ store, agent, job: running, spawnOne });
      expect(launched.ok, `demo worker ${i} launch`).toBe(true);
    }

    const allDemoDone = () => demoJobIds.every((id) => getJob(store, id)?.status === 'done');
    const activeWorkers = () => 3 - demoCompletions;
    expect(activeWorkers(), '3 workers in flight before the window').toBe(3);

    // --- 2) measure interactive-lane ops while the workers run ---
    const samples: OpSample[] = [];
    const measure = async (op: string, target: string, exec: {
      execute(ctx: {
        turnId: string;
        toolCallId: string;
        signal: AbortSignal;
      }): Promise<{ output?: unknown; isError?: boolean }>;
    }) => {
      const startedAt = performance.now();
      const result = await exec.execute({
        turnId: 'v2-6',
        toolCallId: `c_${samples.length}`,
        signal: new AbortController().signal,
      });
      const elapsedMs = performance.now() - startedAt;
      samples.push({ op, target, elapsedMs, workersActive: activeWorkers() });
      return result;
    };

    // JobCreate exercises the full ACK path (ledger upsert + pump + grace race).
    for (let i = 1; i <= 3; i += 1) {
      const tool = new JobCreateTool(store, agent);
      const exec = tool.resolveExecution({
        title: `v2-6 interactive create ${i}`,
        success_criteria: [`interactive create ${i} lands on the ledger`],
      });
      if (exec.isError) throw new Error('resolve failed');
      const result = await measure('JobCreate', `create-${i}`, exec);
      expect(result.isError).toBe(false);
      expect(String(result.output)).toMatch(/ACK job_\w+ state=(queued|running)/);
    }
    for (let i = 1; i <= 4; i += 1) {
      const tool = new JobListTool(store);
      const exec = tool.resolveExecution({ limit: 20 });
      if (exec.isError) throw new Error('resolve failed');
      await measure('JobList', `list-${i}`, exec);
    }
    for (const id of demoJobIds) {
      const tool = new JobInspectTool(store);
      const exec = tool.resolveExecution({ job_id: id });
      if (exec.isError) throw new Error('resolve failed');
      await measure('JobInspect', id, exec);
    }
    for (const id of demoJobIds) {
      const tool = new JobSteerTool(store);
      const exec = tool.resolveExecution({ job_id: id, message: 'v2-6 steer ping' });
      if (exec.isError) throw new Error('resolve failed');
      await measure('JobSteer', id, exec);
    }
    // MergeJob verdict-only path (reject): no dispatch, immediate return.
    {
      const mergeTarget = patchJob(
        store,
        createJob(store, { title: 'v2-6 merge verdict target', kind: 'implement' }).id,
        { status: 'done', resultSummary: 'done work' },
      );
      if (!mergeTarget) throw new Error('failed to prepare merge target');
      const tool = new MergeJobTool(store, agent);
      const exec = tool.resolveExecution({ job_id: mergeTarget.id, approve: false });
      if (exec.isError) throw new Error('resolve failed');
      await measure('MergeJob', mergeTarget.id, exec);
    }

    // --- 3) verdict + instrumentation log ---
    const elapsed = samples.map((s) => s.elapsedMs);
    const maxMs = Math.max(...elapsed);
    const meanMs = elapsed.reduce((a, b) => a + b, 0) / elapsed.length;
    const sorted = [...elapsed].sort((a, b) => a - b);
    const p95Ms = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;

    // Workers were genuinely concurrent with the window: at least one still
    // in flight when the last op ran, and all settle afterwards.
    expect(samples.some((s) => s.workersActive > 0), 'window overlaps worker lifetime').toBe(
      true,
    );
    await until(allDemoDone);
    expect(demoCompletions).toBe(3);
    await getJobWorkerSpawner().settle();

    const reportLines = [
      `# V2-6 main-turn instrumentation — 3 concurrent workers`,
      '',
      `Generated (UTC): ${new Date().toISOString()}`,
      'Procedure: `SUPERLIORA_V2_6_REPORT=1 pnpm -C packages/agent-core exec vitest run test/tools/job-main-turn-instrumentation.test.ts`',
      `Budget (checklist V2-6): main-turn wall-clock max ≤ ${MAIN_TURN_BUDGET_MS}ms`,
      '',
      '## Result',
      '',
      `- ops measured: ${samples.length}`,
      `- max: ${maxMs.toFixed(2)}ms (budget ${MAIN_TURN_BUDGET_MS}ms) — ${maxMs <= MAIN_TURN_BUDGET_MS ? 'PASS' : 'FAIL'}`,
      `- mean: ${meanMs.toFixed(2)}ms`,
      `- p95: ${p95Ms.toFixed(2)}ms`,
      `- concurrent demo workers: 3 (staged ~250ms each); still active for ${
        samples.filter((s) => s.workersActive > 0).length
      }/${samples.length} ops`,
      `- background spawns via JobCreate pump: ${bgSpawnSeq}`,
      '',
      '## Per-op samples',
      '',
      '| # | op | target | wall-clock ms | workers active after op |',
      '|---|---|---|---|---|',
      ...samples.map(
        (s, i) => `| ${i + 1} | ${s.op} | ${s.target} | ${s.elapsedMs.toFixed(2)} | ${s.workersActive} |`,
      ),
      '',
    ];
    const report = reportLines.join('\n');

    if (process.env.SUPERLIORA_V2_6_REPORT === '1') {
      const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
      const reportPath = join(repoRoot, 'reports', '2026-08-03-v2-6-main-turn-instrumentation.md');
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, report, 'utf8');
      console.log(`V2-6 instrumentation report written: ${reportPath}`);
    } else {
      console.log(report);
    }

    expect(
      maxMs,
      `main-turn wall-clock max ${maxMs.toFixed(2)}ms exceeds the ${MAIN_TURN_BUDGET_MS}ms budget`,
    ).toBeLessThanOrEqual(MAIN_TURN_BUDGET_MS);
  });
});
