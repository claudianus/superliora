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
import type { LioraConfig } from '../../../src/config';

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
