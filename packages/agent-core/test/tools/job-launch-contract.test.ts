import { afterEach, describe, expect, it } from 'vitest';

import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import {
  assertNonBlockingLaunch,
  observeCompletion,
} from '../../src/tools/builtin/job/job-lanes';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { launchJobWorker } from '../../src/tools/builtin/job/job-worker';
import type { ToolStore } from '../../src/tools/store';

/**
 * V2-3 — non-blocking launch contract, enforced by runtime observation.
 *
 * Checklist criterion: call `launchJobWorker` with a fake spawn (`spawnOne`
 * injection) and pass if — and only if — the worker completion promise is
 * still PENDING when the launch call returns. The legacy
 * `assertNonBlockingLaunchContract(launchIsFireAndForget: boolean)` took a
 * caller-supplied boolean and proved nothing; it is replaced by
 * `observeCompletion` + `assertNonBlockingLaunch` (job-lanes.ts), which read
 * the real promise state. Any surviving manual-boolean path fails this gate.
 */

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

function runningJob(store: ToolStore, title: string) {
  const job = createJob(store, { title, kind: 'implement' });
  const running = patchJob(store, job.id, {
    status: 'running',
    worktreePath: `/tmp/v2-3/${job.id}`,
  });
  if (!running) throw new Error('failed to promote job to running');
  return running;
}

/** Drain enough microtasks for any awaited completion to flip the probe. */
async function drainMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

describe('V2-3 non-blocking launch contract (runtime observation)', () => {
  afterEach(() => {
    __resetJobWorkerHandlesForTests();
  });

  it('launchJobWorker returns while the injected completion stays pending', async () => {
    const store = memoryStore();
    const job = runningJob(store, 'v2-3 launch contract');

    let resolveCompletion!: (value: { result: string }) => void;
    const completion = new Promise<{ result: string }>((resolve) => {
      resolveCompletion = resolve;
    });
    // Runtime observation of the real completion promise — no caller claim.
    const probe = observeCompletion(completion);

    let spawnCalls = 0;
    const spawnOne = (async () => {
      spawnCalls += 1;
      return {
        agentId: 'agent_v2_3_fake',
        profileName: 'coder',
        resumed: false,
        completion,
      };
    }) as never;
    const agent = { subagentHost: { spawn: async () => ({}) } } as never;

    const result = await launchJobWorker({ store, agent, job, spawnOne });

    expect(result.ok).toBe(true);
    expect(result.workerAgentId).toBe('agent_v2_3_fake');
    expect(spawnCalls).toBe(1);

    // Contract assertion (checklist V2-3): at return time the completion must
    // be unresolved. Observed promise state, not a boolean argument.
    await drainMicrotasks();
    expect(probe.settled).toBe(false);
    assertNonBlockingLaunch(probe);

    // The worker id landed on the ledger even though the worker is in flight.
    expect(getJob(store, job.id)?.workerAgentId).toBe('agent_v2_3_fake');
    expect(getJob(store, job.id)?.status).toBe('running');

    // Observation is real: settling the completion afterwards flips the probe
    // and the fire-and-forget wiring lands the terminal state off-turn.
    resolveCompletion({ result: 'v2-3 worker done' });
    await drainMicrotasks();
    await drainMicrotasks();
    expect(probe.settled).toBe(true);
    expect(getJob(store, job.id)?.status).toBe('done');
    expect(getJob(store, job.id)?.resultSummary).toContain('v2-3 worker done');
  });

  it('a launch that awaits completion is caught by the observed assertion', async () => {
    // Control case: simulates the violating implementation (await completion
    // before returning). The probe has settled by return time, so the
    // assertion throws — the manual boolean could never detect this.
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const probe = observeCompletion(completion);

    const blockingLaunch = async (): Promise<void> => {
      await completion; // the violation: launch blocks on worker lifetime
    };

    resolveCompletion();
    await blockingLaunch();
    await drainMicrotasks();
    expect(probe.settled).toBe(true);
    expect(() => assertNonBlockingLaunch(probe)).toThrow(
      /completion settled before launch returned/,
    );
  });

  it('an immediately-resolving completion never blocks the launch and lands off-turn', async () => {
    // Fast-worker case: the completion is already resolved when observed.
    // The launch must still return normally and never join the completion
    // chain — the terminal ledger state arrives via the off-turn wiring.
    const store = memoryStore();
    const job = runningJob(store, 'v2-3 fast worker');

    const completion = Promise.resolve({ result: 'fast worker done' });
    const probe = observeCompletion(completion);
    const spawnOne = (async () => ({
      agentId: 'agent_v2_3_fast',
      profileName: 'coder',
      resumed: false,
      completion,
    })) as never;
    const agent = { subagentHost: { spawn: async () => ({}) } } as never;

    const result = await launchJobWorker({ store, agent, job, spawnOne });
    expect(result.ok).toBe(true);
    expect(result.workerAgentId).toBe('agent_v2_3_fast');

    // The settlement is observed (probe flips) and the fire-and-forget
    // wiring lands the terminal state off-turn.
    await drainMicrotasks();
    await drainMicrotasks();
    expect(probe.settled).toBe(true);
    expect(getJob(store, job.id)?.status).toBe('done');
    expect(getJob(store, job.id)?.resultSummary).toContain('fast worker done');
  });
});
