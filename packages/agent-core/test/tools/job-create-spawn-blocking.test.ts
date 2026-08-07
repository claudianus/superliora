import { afterEach, describe, expect, it } from 'vitest';

import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { getJob } from '../../src/tools/builtin/job/job-ledger';
import { JobCreateTool } from '../../src/tools/builtin/job/job-tools';
import type { ToolStore } from '../../src/tools/store';

/**
 * Incident 2026-08-03 — 125-second spawn block (checklist V7-1).
 *
 * The spawn chain behind a Job worker (`subagent-host.ts`:
 * `ensureAgentResumed` → `assertContractCompiles` → `createAgent`) once took
 * ~125s, and the JobCreate ACK awaited that handshake, freezing the
 * conductor turn. Contract G1 caps the ACK at 250ms no matter how slow the
 * spawn handshake is (§3.3).
 *
 * Red→green protocol: this test injects a spawn-chain delay modeled on the
 * incident (120s) and asserts the ACK still returns within the deadline. It
 * is red while the ACK path awaits the spawn chain, and turns green once G1
 * (ACK detaches from scheduling) and G2 (spawn isolation) land.
 */

/** Incident magnitude: the spawn chain blocked the lane for ~125s. */
const SPAWN_CHAIN_DELAY_MS = 120_000;
/** Contract §3.3 G1: JobCreate ACK deadline. */
const ACK_DEADLINE_MS = 250;

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

describe('JobCreate ACK vs slow spawn chain (incident 2026-08-03, V7-1)', () => {
  afterEach(() => {
    __resetJobWorkerHandlesForTests();
  });

  it(`returns the ACK within ${ACK_DEADLINE_MS}ms even when the spawn chain takes ${SPAWN_CHAIN_DELAY_MS / 1000}s`, async () => {
    const store = memoryStore();
    let spawnEntered = 0;
    let releaseSpawn!: () => void;
    // Gate standing in for the 120s spawn chain (ensureAgentResumed →
    // assertContractCompiles → createAgent). Released after the ACK race so
    // the test never sleeps for real.
    const spawnChain = new Promise<void>((resolve) => {
      releaseSpawn = resolve;
    });
    const host = {
      spawn: async (options: { profileName?: string }) => {
        spawnEntered += 1;
        await spawnChain;
        return {
          agentId: 'agent_slow_spawn',
          profileName: options.profileName ?? 'coder',
          resumed: false,
          completion: new Promise<never>(() => {}),
        } as never;
      },
    };
    const agent = { subagentHost: host, config: { cwd: undefined } } as never;
    const tool = new JobCreateTool(store, agent);
    const exec = tool.resolveExecution({
      title: 'incident: slow spawn',
      kind: 'implement',
      success_criteria: ['spawn ACK stays under the grace deadline'],
    });
    if (exec.isError) throw new Error('resolve failed');

    try {
      const startedAt = Date.now();
      const race = await Promise.race([
        exec
          .execute({ turnId: 't', toolCallId: 'c_slow_spawn', signal: new AbortController().signal })
          .then((result) => ({ kind: 'ack', result, elapsedMs: Date.now() - startedAt }) as const),
        new Promise<{ kind: 'deadline'; elapsedMs: number }>((resolve) => {
          const timer = setTimeout(
            () => resolve({ kind: 'deadline', elapsedMs: Date.now() - startedAt }),
            ACK_DEADLINE_MS,
          );
          timer.unref?.();
        }),
      ]);

      // Scenario sanity: the launch path entered the spawn chain exactly once.
      expect(spawnEntered, 'spawn chain should be entered exactly once').toBe(1);

      expect(
        race.kind,
        `JobCreate ACK blocked on the spawn chain for ${race.elapsedMs}ms ` +
          `(incident 2026-08-03: ~125s; contract G1 caps ACK at ${ACK_DEADLINE_MS}ms)`,
      ).toBe('ack');
      if (race.kind !== 'ack') return;

      expect(race.elapsedMs).toBeLessThanOrEqual(ACK_DEADLINE_MS);
      const output = String(race.result.output);
      expect(output).toMatch(/ACK job_\w+ state=running/);

      const jobId = /ACK (job_\w+)/.exec(output)?.[1];
      expect(jobId).toBeDefined();
      // The ledger already shows the promoted job; the worker id is still
      // pending because the spawn handshake has not finished.
      expect(getJob(store, jobId!)?.status).toBe('running');
      expect(getJob(store, jobId!)?.workerAgentId).toBeUndefined();

      // Late spawn completion still registers the worker in the background.
      releaseSpawn();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getJob(store, jobId!)?.workerAgentId).toBe('agent_slow_spawn');
    } finally {
      // Never leave the simulated spawn chain hanging when the test is red.
      releaseSpawn();
    }
  });
});
