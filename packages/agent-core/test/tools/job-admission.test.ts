/**
 * Admission runs on the offload lane, before a job takes a spawn slot. It used
 * to run inside the spawn handshake, where the serial model probes ate the 30s
 * budget and held a slot: one degraded provider parked every slot in a probe
 * loop and the ledger blamed `spawn_budget_exceeded` — a timeout — while the
 * real cause was `no live worker model`.
 */
import { APIStatusError } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetLiveProbeCacheForTests,
  resetModelRouteHealthStoreForTests,
  setLiveProbeRunnerForTests,
} from '../../src/agent/routing';
import { getJob } from '../../src/tools/builtin/job/job-ledger';
import { admitJobWorkerLaunch } from '../../src/tools/builtin/job/job-worker';
import { createJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
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

/**
 * Surface kind is declared, so the objective-profile step short-circuits before
 * any classifier call; no provider is set, so `classifierDepsFromAgent` is
 * undefined and nothing reaches the network.
 */
function admissionAgent(store: ToolStore) {
  const runtimeConfig = {
    providers: { 'test-provider': { type: 'kimi' as const, apiKey: 'test-key' } },
    models: {
      'worker-a': {
        provider: 'test-provider',
        model: 'worker-a',
        maxContextSize: 128_000,
        capabilities: ['tool_use'],
        cost: { input: 1 },
      },
    },
  };
  return {
    type: 'main' as const,
    runtimeConfig,
    kimiConfig: runtimeConfig,
    config: {
      modelAlias: 'worker-a',
      effectiveModelAlias: 'worker-a',
      thinkingLevel: 'off' as const,
      profileName: 'coder',
    },
    modelProvider: { currentConfig: () => runtimeConfig },
    tools: { toolStore: store, getStore: () => store },
    log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
    emitEvent: () => {},
    permission: { mode: 'auto' as const },
    records: { logRecord: () => {} },
    telemetry: { track: () => {} },
    context: { appendSystemReminder: () => {} },
  };
}

function runningJob(store: ToolStore, modelAlias?: string) {
  const job = createJob(store, { title: 'Fix the parser', kind: 'implement' });
  return patchJob(store, job.id, {
    status: 'running',
    surfaceKind: 'none',
    ...(modelAlias !== undefined ? { modelAlias } : {}),
  })!;
}

describe('admitJobWorkerLaunch', () => {
  beforeEach(() => {
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
  });

  afterEach(() => {
    setLiveProbeRunnerForTests(undefined);
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
  });

  it('blocks the job with the model reason instead of a spawn timeout', async () => {
    setLiveProbeRunnerForTests(async () => {
      throw new APIStatusError(401, 'unauthorized', 'req-401');
    });
    const store = memoryStore();
    const agent = admissionAgent(store);
    const job = runningJob(store, 'worker-a');

    const result = await admitJobWorkerLaunch({ store, agent: agent as never, job });

    expect(result.ok).toBe(false);
    const blocked = getJob(store, job.id)!;
    expect(blocked.status).toBe('blocked');
    expect(blocked.notes).toMatch(/spawn_blocked:/);
    expect(blocked.notes).toMatch(/model_failed: alias=worker-a/);
    // The point of the move: the handshake budget never ran, so its note must
    // not be what the operator sees.
    expect(blocked.notes).not.toMatch(/spawn_budget_exceeded/);
  });

  it('admits a job whose alias is alive and pins the probed alias', async () => {
    setLiveProbeRunnerForTests(async () => {});
    const store = memoryStore();
    const agent = admissionAgent(store);
    const job = runningJob(store, 'worker-a');

    const result = await admitJobWorkerLaunch({ store, agent: agent as never, job });

    expect(result.ok).toBe(true);
    expect(getJob(store, job.id)!.status).toBe('running');
    expect(getJob(store, job.id)!.modelAlias).toBe('worker-a');
  });

  it('reports a stuck probe as a preflight timeout rather than throwing', async () => {
    // A probe that only settles when its signal aborts stands in for a gateway
    // that answers nothing; admission must still return a recorded block.
    setLiveProbeRunnerForTests(
      (_agent, _alias, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new APIStatusError(408, 'aborted', 'req-timeout'));
            },
            { once: true },
          );
        }),
    );
    const store = memoryStore();
    const agent = admissionAgent(store);
    const job = runningJob(store, 'worker-a');

    const result = await admitJobWorkerLaunch({
      store,
      agent: agent as never,
      job,
      admissionBudgetMs: 25,
    });

    expect(result.ok).toBe(false);
    const blocked = getJob(store, job.id)!;
    expect(blocked.status).toBe('blocked');
    expect(blocked.notes).toMatch(/preflight_timeout/);
  });
});