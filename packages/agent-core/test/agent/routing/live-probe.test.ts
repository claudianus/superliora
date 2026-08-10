import { beforeEach, describe, expect, it } from 'vitest';
import { APIStatusError } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

import type { Agent } from '../../../src/agent';
import {
  ensureSmartRouteProbed,
  invalidateLiveProbeSuccess,
  isConfigAliasHealthy,
  isLiveProbeFailureFresh,
  isLiveProbeSuccessFresh,
  probeModelAlias,
  resetLiveProbeCacheForTests,
  resetModelRouteHealthStoreForTests,
  setLiveProbeRunnerForTests,
  sharedModelRouteHealthStore,
  type SmartRoute,
} from '../../../src/agent/routing';
import type { LioraConfig } from '../../../src/config';

function model(provider: string, name: string, inputCost: number) {
  return {
    provider,
    model: name,
    maxContextSize: 128_000,
    capabilities: ['tool_use', 'thinking'],
    cost: { input: inputCost },
  };
}

function makeConfig(): LioraConfig {
  return {
    providers: {
      'provider-a': { type: 'kimi' as const, apiKey: 'key-a' },
      'provider-b': { type: 'kimi' as const, apiKey: 'key-b' },
    },
    models: {
      primary: model('provider-a', 'primary-model', 5),
      secondary: model('provider-b', 'secondary-model', 1),
    },
  } as LioraConfig;
}

function makeAgent(config: LioraConfig): Agent {
  return {
    runtimeConfig: config,
    kimiConfig: config,
    log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
    modelProvider: {
      resolveProviderConfig: (alias: string) => ({
        modelAlias: alias,
        providerName: config.models?.[alias]?.provider ?? 'provider-a',
        provider: { type: 'kimi', model: alias },
      }),
      resolveAuth: () => undefined,
    },
    config: {
      modelAlias: 'auto',
      effectiveModelAlias: 'primary',
      setSmartRouteAlias: () => {},
    },
  } as unknown as Agent;
}

function route(alias: string, chain: readonly string[]): SmartRoute {
  return {
    role: 'coding',
    intensity: 'balanced',
    alias,
    chain,
    thinkingLevel: 'high',
    source: 'auto',
    reason: 'test',
  };
}

describe('live-probe', () => {
  beforeEach(() => {
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
  });

  it('skips generate when static health fails', async () => {
    let calls = 0;
    setLiveProbeRunnerForTests(async () => {
      calls += 1;
    });
    const config = {
      providers: {
        ghost: { type: 'kimi' as const },
      },
      models: {
        orphan: {
          provider: 'ghost',
          model: 'ghost',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
        },
      },
    } as LioraConfig;
    const result = await probeModelAlias(makeAgent(config), 'orphan');
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('falls through primary failure to secondary success', async () => {
    const calls: string[] = [];
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      calls.push(alias);
      if (alias === 'primary') {
        throw new APIStatusError(401, 'unauthorized', 'req-401');
      }
    });
    const agent = makeAgent(makeConfig());
    const probed = await ensureSmartRouteProbed(agent, route('primary', ['primary', 'secondary']));
    expect(probed?.alias).toBe('secondary');
    expect(calls).toEqual(['primary', 'secondary']);
    expect(isLiveProbeSuccessFresh('secondary')).toBe(true);
    expect(sharedCredentialHealthStore.isAvailable('provider-a')).toBe(false);
    expect(sharedCredentialHealthStore.isAvailable('provider-b')).toBe(true);
  });

  it('does not re-call generate when success cache is fresh', async () => {
    let calls = 0;
    setLiveProbeRunnerForTests(async () => {
      calls += 1;
    });
    const agent = makeAgent(makeConfig());
    await probeModelAlias(agent, 'primary');
    await probeModelAlias(agent, 'primary');
    expect(calls).toBe(1);
  });

  it('dedupes in-flight probes for the same alias', async () => {
    let calls = 0;
    setLiveProbeRunnerForTests(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
    });
    const agent = makeAgent(makeConfig());
    const [a, b] = await Promise.all([
      probeModelAlias(agent, 'primary'),
      probeModelAlias(agent, 'primary'),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('invalidates success cache so the next probe hits the network', async () => {
    let calls = 0;
    setLiveProbeRunnerForTests(async () => {
      calls += 1;
    });
    const agent = makeAgent(makeConfig());
    await probeModelAlias(agent, 'primary');
    invalidateLiveProbeSuccess('primary');
    await probeModelAlias(agent, 'primary');
    expect(calls).toBe(2);
  });

  it('returns undefined when the whole chain fails', async () => {
    setLiveProbeRunnerForTests(async () => {
      throw new APIStatusError(500, 'server error', 'req-500');
    });
    const agent = makeAgent(makeConfig());
    const probed = await ensureSmartRouteProbed(agent, route('primary', ['primary', 'secondary']));
    expect(probed).toBeUndefined();
  });

  it('marks alias unavailable on model_not_found without poisoning sibling provider models', async () => {
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      if (alias === 'primary') {
        throw new APIStatusError(404, 'model_not_found: primary-model', 'req-404');
      }
    });
    const config = makeConfig();
    // Both aliases on provider-a so we can prove sibling stays healthy.
    config.models = {
      primary: model('provider-a', 'primary-model', 5),
      secondary: model('provider-a', 'secondary-model', 1),
    };
    const agent = makeAgent(config);
    const probed = await ensureSmartRouteProbed(agent, route('primary', ['primary', 'secondary']));
    expect(probed?.alias).toBe('secondary');
    expect(sharedModelRouteHealthStore.isAvailable('primary')).toBe(false);
    expect(isLiveProbeFailureFresh('primary')).toBe(true);
    expect(isConfigAliasHealthy(config, 'primary')).toBe(false);
    expect(isConfigAliasHealthy(config, 'secondary')).toBe(true);
    expect(sharedCredentialHealthStore.isAvailable('provider-a')).toBe(true);
  });
});
