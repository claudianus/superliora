import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APIEmptyResponseError, APIStatusError } from '@superliora/kosong';
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

  it('empty probe reject lists remaining live aliases without killing the provider', async () => {
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      if (alias === 'dead-a') {
        throw new APIEmptyResponseError('empty response');
      }
    });
    const store = memoryStore();
    const agent = makeAgent({
      models: {
        'dead-a': {
          provider: 'test-provider',
          model: 'dead-a',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
        'live-sibling': {
          provider: 'test-provider',
          model: 'live-sibling',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
        'live-other': {
          provider: 'other-provider',
          model: 'live-other',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
      },
    });
    (agent as { runtimeConfig: { providers: Record<string, unknown> } }).runtimeConfig.providers[
      'other-provider'
    ] = { type: 'kimi', apiKey: 'other-key' };
    (agent as { kimiConfig: { providers: Record<string, unknown> } }).kimiConfig.providers[
      'other-provider'
    ] = { type: 'kimi', apiKey: 'other-key' };
    const tool = new JobCreateTool(store, agent as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed'],
      model_alias: 'dead-a',
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
    const output = String(result.output);
    expect(output).toMatch(/failed live probe \(empty\)/);
    expect(output).toMatch(/Still live now:.*live-sibling/);
    expect(output).toMatch(/Still live now:.*live-other/);
    expect(listJobs(store)).toHaveLength(0);
    expect(sharedCredentialHealthStore.isAvailable('test-provider')).toBe(true);
  });

  it('cursor API-lane quota reject prefers included-lane aliases in Still live', async () => {
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      if (alias === 'cursor-oauth/claude-opus') {
        throw new APIStatusError(429, 'quota exceeded', 'req-429');
      }
    });
    const store = memoryStore();
    const agent = makeAgent({
      models: {
        'cursor-oauth/claude-opus': {
          provider: 'cursor-oauth',
          model: 'claude-opus',
          maxContextSize: 200_000,
          capabilities: ['tool_use'],
          cost: { input: 5 },
        },
        'cursor-oauth/kimi-k3-high': {
          provider: 'cursor-oauth',
          model: 'kimi-k3-high',
          maxContextSize: 200_000,
          capabilities: ['tool_use'],
          cost: { input: 3 },
        },
        'cursor-oauth/default': {
          provider: 'cursor-oauth',
          model: 'default',
          maxContextSize: 200_000,
          capabilities: ['tool_use'],
          cost: { input: 0 },
        },
        'cursor-oauth/composer-2.5': {
          provider: 'cursor-oauth',
          model: 'composer-2.5',
          maxContextSize: 200_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
        'cursor-oauth/cursor-grok-4.5-high': {
          provider: 'cursor-oauth',
          model: 'cursor-grok-4.5-high',
          maxContextSize: 500_000,
          capabilities: ['tool_use'],
          cost: { input: 2 },
        },
      },
    });
    (agent as { runtimeConfig: { providers: Record<string, unknown> } }).runtimeConfig.providers[
      'cursor-oauth'
    ] = { type: 'cursor', apiKey: 'cursor-key' };
    (agent as { kimiConfig: { providers: Record<string, unknown> } }).kimiConfig.providers[
      'cursor-oauth'
    ] = { type: 'cursor', apiKey: 'cursor-key' };
    const tool = new JobCreateTool(store, agent as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed'],
      model_alias: 'cursor-oauth/claude-opus',
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
    const output = String(result.output);
    expect(output).toMatch(/failed live probe \(quota\)/);
    const still = /Still live now: (.+?)\. Pick one/.exec(output)?.[1] ?? '';
    const listed = still.split(', ').map((s) => s.trim());
    expect(listed.slice(0, 3)).toEqual([
      'cursor-oauth/composer-2.5',
      'cursor-oauth/cursor-grok-4.5-high',
      'cursor-oauth/default',
    ]);
    expect(listed.indexOf('cursor-oauth/kimi-k3-high')).toBeGreaterThan(2);
    expect(sharedCredentialHealthStore.isAvailable('cursor-oauth')).toBe(true);
  });

  it('unknown model_alias reject lists still-live aliases', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store, makeAgent() as never);
    const exec = tool.resolveExecution({
      title: 'Explore auth',
      kind: 'explore',
      prompt: 'Find auth entrypoints',
      success_criteria: ['paths listed'],
      model_alias: 'xai-grok/grok-4.5',
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
    expect(String(result.output)).toMatch(/unknown or unhealthy/);
    expect(String(result.output)).toContain('Still live now: worker-a');
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
