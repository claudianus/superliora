import { beforeEach, describe, expect, it } from 'vitest';
import { APIStatusError } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

import type { Agent } from '../../../src/agent';
import {
  applySessionSmartAutoForTurn,
  resetLiveProbeCacheForTests,
  resetModelRouteHealthStoreForTests,
  setLiveProbeRunnerForTests,
  sharedModelRouteHealthStore,
} from '../../../src/agent/routing';
import { applyCacheAffinityHold } from '../../../src/agent/routing/session-auto';
import type { LioraConfig } from '../../../src/config';
import type { SmartRoute } from '../../../src/agent/routing/smart-router';

function freeModel(provider: string, name: string) {
  return {
    provider,
    model: name,
    maxContextSize: 262_144,
    capabilities: ['tool_use', 'thinking'],
    cost: { input: 0 },
  };
}

function makeConfig(): LioraConfig {
  return {
    providers: {
      opencode: { type: 'openai' as const, apiKey: 'key-free' },
    },
    models: {
      'opencode/hy3-free': freeModel('opencode', 'hy3-free'),
      'opencode/mimo-v2.5-free': freeModel('opencode', 'mimo-v2.5-free'),
    },
    freeMode: true,
  } as LioraConfig;
}

function makeAgent(config: LioraConfig): Agent {
  const captured: string[] = [];
  const agent = {
    runtimeConfig: config,
    kimiConfig: config,
    log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
    emitEvent: () => {},
    modelProvider: {
      resolveProviderConfig: (alias: string) => ({
        modelAlias: alias,
        providerName: config.models?.[alias]?.provider ?? 'opencode',
        provider: { type: 'openai', model: alias },
      }),
      resolveAuth: () => undefined,
    },
    config: {
      modelAlias: 'auto',
      effectiveModelAlias: undefined,
      pinnedAlias: undefined,
      setSmartRouteAlias: (alias: string | undefined) => {
        agent.config.pinnedAlias = alias;
        agent.config.effectiveModelAlias = alias ?? 'auto';
      },
    },
  } as unknown as Agent & { config: { pinnedAlias?: string } };
  void captured;
  return agent;
}

describe('applySessionSmartAutoForTurn FREE fallback', () => {
  beforeEach(() => {
    resetLiveProbeCacheForTests();
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
  });

  it('marks the fallback alias healthy when every free candidate failed live probe', async () => {
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      throw new APIStatusError(500, `probe fail ${alias}`, 'req-500');
    });
    const agent = makeAgent(makeConfig());
    const result = await applySessionSmartAutoForTurn(agent, [{ type: 'text', text: 'hi' }]);
    expect(result).toBeDefined();
    expect(result?.alias).toContain('-free');

    const pinned = (agent.config as { pinnedAlias?: string }).pinnedAlias;
    expect(pinned).toBe(result?.alias);

    // The regression: after the fallback pins a concrete alias, the alias and
    // provider must not still be flagged unhealthy, or the very next LLM call
    // would degrade back to the virtual `auto` alias and throw
    // `Model "auto" is not configured`.
    expect(sharedModelRouteHealthStore.isAvailable(result!.alias)).toBe(true);
    expect(sharedCredentialHealthStore.isAvailable('opencode')).toBe(true);
  });

  it('marks the fallback alias healthy when routing yields no healthy free model', async () => {
    setLiveProbeRunnerForTests(async () => {});
    const agent = makeAgent(makeConfig());
    // Force route resolution to fail by marking both aliases unhealthy.
    sharedModelRouteHealthStore.markUnavailable('opencode/hy3-free', { cooldownMs: 60_000 });
    sharedModelRouteHealthStore.markUnavailable('opencode/mimo-v2.5-free', { cooldownMs: 60_000 });
    sharedCredentialHealthStore.markRateLimited('opencode', { cooldownMs: 60_000 });

    const result = await applySessionSmartAutoForTurn(agent, [{ type: 'text', text: 'hi' }]);

    expect(result).toBeDefined();
    expect(result?.alias).toContain('-free');
    const pinned = (agent.config as { pinnedAlias?: string }).pinnedAlias;
    expect(pinned).toBe(result?.alias);
    expect(sharedModelRouteHealthStore.isAvailable(result!.alias)).toBe(true);
    expect(sharedCredentialHealthStore.isAvailable('opencode')).toBe(true);
  });
});

describe('applyCacheAffinityHold', () => {
  function paidConfig(): LioraConfig {
    return {
      providers: {
        'test-provider': { type: 'openai' as const, apiKey: 'key-paid' },
      },
      models: {
        'test-provider/big': {
          provider: 'test-provider',
          model: 'big',
          maxContextSize: 262_144,
          capabilities: ['tool_use', 'thinking'],
        },
        'test-provider/small': {
          provider: 'test-provider',
          model: 'small',
          maxContextSize: 262_144,
          capabilities: ['tool_use'],
        },
      },
    } as LioraConfig;
  }

  function makeHoldAgent(over: {
    readonly established?: string;
    readonly warmStreak?: number;
    readonly flagEnabled?: boolean;
  }): Agent {
    return {
      runtimeConfig: paidConfig(),
      kimiConfig: paidConfig(),
      log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
      emitEvent: () => {},
      config: {
        modelAlias: 'auto',
        effectiveModelAlias: over.established,
      },
      usage: { warmStreak: over.warmStreak ?? 0 },
      experimentalFlags: { enabled: () => over.flagEnabled !== false },
    } as unknown as Agent;
  }

  function routeTo(alias: string): SmartRoute {
    return {
      role: 'exploration',
      intensity: 'balanced',
      alias,
      chain: [alias],
      thinkingLevel: 'off',
      source: 'auto',
      reason: 'explore prompt',
    };
  }

  beforeEach(() => {
    resetModelRouteHealthStoreForTests();
    sharedCredentialHealthStore.clear();
  });

  it('holds the established alias when the session cache is warm', () => {
    const agent = makeHoldAgent({ established: 'test-provider/big', warmStreak: 3 });
    const held = applyCacheAffinityHold(agent, paidConfig(), routeTo('test-provider/small'));
    expect(held.alias).toBe('test-provider/big');
    expect(held.chain[0]).toBe('test-provider/big');
    expect(held.reason).toContain('cache-affinity hold');
  });

  it('lets a cold session switch aliases freely', () => {
    const agent = makeHoldAgent({ established: 'test-provider/big', warmStreak: 1 });
    const held = applyCacheAffinityHold(agent, paidConfig(), routeTo('test-provider/small'));
    expect(held.alias).toBe('test-provider/small');
  });

  it('does not hold when nothing is established (fresh pin or explicit switch)', () => {
    const agent = makeHoldAgent({ established: 'auto', warmStreak: 5 });
    const held = applyCacheAffinityHold(agent, paidConfig(), routeTo('test-provider/small'));
    expect(held.alias).toBe('test-provider/small');
  });

  it('does not hold when the established alias is unhealthy', () => {
    const agent = makeHoldAgent({ established: 'test-provider/big', warmStreak: 5 });
    sharedModelRouteHealthStore.markUnavailable('test-provider/big', { cooldownMs: 60_000 });
    const held = applyCacheAffinityHold(agent, paidConfig(), routeTo('test-provider/small'));
    expect(held.alias).toBe('test-provider/small');
  });

  it('does not hold in FREE mode', () => {
    const agent = makeHoldAgent({ established: 'test-provider/big', warmStreak: 5 });
    const config = { ...paidConfig(), freeMode: true } as LioraConfig;
    const held = applyCacheAffinityHold(agent, config, routeTo('test-provider/small'));
    expect(held.alias).toBe('test-provider/small');
  });

  it('respects the kill-switch flag', () => {
    const agent = makeHoldAgent({
      established: 'test-provider/big',
      warmStreak: 5,
      flagEnabled: false,
    });
    const held = applyCacheAffinityHold(agent, paidConfig(), routeTo('test-provider/small'));
    expect(held.alias).toBe('test-provider/small');
  });
});
