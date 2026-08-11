import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APIStatusError } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

import {
  resetLiveProbeCacheForTests,
  resetModelRouteHealthStoreForTests,
  setLiveProbeRunnerForTests,
  sharedModelRouteHealthStore,
} from '../../src/agent/routing';
import { getJob, listJobs } from '../../src/tools/builtin/job/job-ledger';
import { preflightJobWorkerModel } from '../../src/tools/builtin/job/job-model-live';
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

function makeAgent(overrides?: {
  readonly models?: Record<string, unknown>;
  readonly modelAlias?: string;
  readonly effectiveModelAlias?: string;
}) {
  const models = overrides?.models ?? {
    'worker-a': {
      provider: 'test-provider',
      model: 'worker-a',
      maxContextSize: 128_000,
      capabilities: ['tool_use'],
      cost: { input: 1 },
    },
  };
  const runtimeConfig = {
    providers: {
      'test-provider': { type: 'kimi' as const, apiKey: 'test-key' },
    },
    models,
  };
  return {
    runtimeConfig,
    kimiConfig: runtimeConfig,
    config: {
      modelAlias: overrides?.modelAlias ?? 'worker-a',
      effectiveModelAlias: overrides?.effectiveModelAlias ?? overrides?.modelAlias ?? 'worker-a',
      thinkingLevel: 'off' as const,
    },
    log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
    modelProvider: {
      currentConfig: () => runtimeConfig,
      resolveProviderConfig: (alias: string) => ({
        modelAlias: alias,
        providerName: 'test-provider',
        provider: { type: 'kimi', model: alias },
      }),
      resolveAuth: () => undefined,
    },
  };
}

describe('JobCreate.model_alias', () => {
  beforeEach(() => {
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
    setLiveProbeRunnerForTests(async () => {});
  });

  afterEach(() => {
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
    setLiveProbeRunnerForTests(undefined);
  });

  it('stores a healthy model_alias on the ledger and ACK after live probe', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store, makeAgent() as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed with line citations'],
      model_alias: 'worker-a',
      staff: false,
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBeFalsy();
    expect(String(result.output)).toContain('model: worker-a');
    const job = listJobs(store)[0]!;
    expect(getJob(store, job.id)?.modelAlias).toBe('worker-a');
  });

  it('rejects unknown model_alias', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store, makeAgent() as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed'],
      model_alias: 'not-a-real-model',
      staff: false,
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/unknown or unhealthy|fleet_model_catalog/);
    expect(listJobs(store)).toHaveLength(0);
  });

  it('rejects model_alias that fails live probe (quota/auth)', async () => {
    setLiveProbeRunnerForTests(async () => {
      throw new APIStatusError(429, 'quota exceeded', 'req-429');
    });
    const store = memoryStore();
    const tool = new JobCreateTool(store, makeAgent() as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed'],
      model_alias: 'worker-a',
      staff: false,
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/failed live probe|Do not blind-retry/);
    expect(listJobs(store)).toHaveLength(0);
    expect(sharedModelRouteHealthStore.isAvailable('worker-a')).toBe(false);
  });
});

describe('preflightJobWorkerModel', () => {
  beforeEach(() => {
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
    setLiveProbeRunnerForTests(async () => {});
  });

  afterEach(() => {
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
    setLiveProbeRunnerForTests(undefined);
  });

  it('blocks spawn when pinned alias fails live probe and leaves model_failed note', async () => {
    setLiveProbeRunnerForTests(async () => {
      throw new APIStatusError(401, 'unauthorized', 'req-401');
    });
    const agent = makeAgent() as never;
    const result = await preflightJobWorkerModel(agent, {
      id: 'job_x',
      title: 'Fix UI',
      kind: 'implement',
      status: 'running',
      priority: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      modelAlias: 'worker-a',
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note).toMatch(/model_failed: alias=worker-a/);
    expect(result.error).toMatch(/failed live probe/);
  });

  it('falls back to Conductor parent when role chain aliases all probe_fail', async () => {
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      if (alias === 'parent-live') return;
      throw new APIStatusError(429, 'quota exceeded', 'req-429');
    });
    const agent = makeAgent({
      modelAlias: 'parent-live',
      models: {
        'cheap-dead': {
          provider: 'test-provider',
          model: 'cheap-dead',
          maxContextSize: 128_000,
          capabilities: ['tool_use', 'thinking'],
          cost: { input: 0.05 },
        },
        'parent-live': {
          provider: 'test-provider',
          model: 'parent-live',
          maxContextSize: 200_000,
          capabilities: ['tool_use', 'thinking'],
          cost: { input: 12 },
        },
      },
    }) as never;

    const result = await preflightJobWorkerModel(agent, {
      id: 'job_goal',
      title: 'Ship game',
      kind: 'goal-driver',
      status: 'running',
      priority: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prompt: 'infinite improvements',
      goalObjective: 'infinite improvements',
      goalCompletionCriterion: 'sellable quality',
    } as never);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.modelAlias).toBe('parent-live');
  });
});
