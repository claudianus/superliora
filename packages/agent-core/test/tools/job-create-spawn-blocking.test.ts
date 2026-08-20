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
 * Red→green protocol: this test holds the spawn handshake open and asserts
 * the ACK returns (and the ledger is already `running`) before the handshake
 * finishes. It is red while the ACK path awaits the spawn chain.
 */

/** Incident magnitude: the spawn chain blocked the lane for ~125s. */
const SPAWN_CHAIN_DELAY_MS = 120_000;

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

  it(`returns the ACK without waiting for a ${SPAWN_CHAIN_DELAY_MS / 1000}s spawn chain`, async () => {
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
      const result = await exec.execute({
        turnId: 't',
        toolCallId: 'c_slow_spawn',
        signal: new AbortController().signal,
      });

      // Scenario sanity: the launch path entered the spawn chain exactly once,
      // and the ACK returned while that handshake is still gated.
      expect(spawnEntered, 'spawn chain should be entered exactly once').toBe(1);
      const output = String(result.output);
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
  }, 10_000);
});
