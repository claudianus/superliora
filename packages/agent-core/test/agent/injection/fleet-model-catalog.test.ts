import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  renderFleetModelCatalog,
  selectFleetCatalogRows,
} from '../../../src/agent/injection/fleet-model-catalog';
import {
  resetLiveProbeCacheForTests,
  resetModelRouteHealthStoreForTests,
  setLiveProbeRunnerForTests,
  probeModelAlias,
} from '../../../src/agent/routing';
import type { LioraConfig } from '../../../src/config';
import { APIStatusError } from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

const PROVIDER = {
  type: 'kimi' as const,
  apiKey: 'test-key',
};

function config(partial: Partial<LioraConfig> & { models: LioraConfig['models'] }): LioraConfig {
  return {
    providers: { 'test-provider': PROVIDER },
    ...partial,
  } as LioraConfig;
}

describe('fleet model catalog', () => {
  beforeEach(() => {
    resetModelRouteHealthStoreForTests();
    resetLiveProbeCacheForTests();
    sharedCredentialHealthStore.clear();
    setLiveProbeRunnerForTests(async () => {});
  });
  afterEach(() => {
    resetModelRouteHealthStoreForTests();
    resetLiveProbeCacheForTests();
    sharedCredentialHealthStore.clear();
    setLiveProbeRunnerForTests(undefined);
  });

  it('ranks healthy tool-capable aliases and renders a capped card', () => {
    const cfg = config({
      models: {
        cheap: {
          provider: 'test-provider',
          model: 'cheap',
          maxContextSize: 64_000,
          capabilities: ['tool_use'],
          cost: { input: 0.1 },
        },
        strong: {
          provider: 'test-provider',
          model: 'strong',
          maxContextSize: 200_000,
          capabilities: ['tool_use', 'thinking', 'image_in'],
          cost: { input: 5 },
        },
      },
    });
    const rows = selectFleetCatalogRows(cfg);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const text = renderFleetModelCatalog(cfg);
    expect(text).toContain('<fleet_model_catalog>');
    expect(text).toContain('JobCreate.model_alias');
    expect(text).toMatch(/cheap|strong/);
  });

  it('hides aliases with a fresh live-probe failure', async () => {
    // model_not_found is alias-scoped — sibling models on the same provider stay usable.
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      if (alias === 'broken') {
        throw new APIStatusError(404, 'model_not_found: broken', 'req-404');
      }
    });
    const cfg = config({
      models: {
        broken: {
          provider: 'test-provider',
          model: 'broken',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
        ok: {
          provider: 'test-provider',
          model: 'ok',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
      },
    });
    const agent = {
      runtimeConfig: cfg,
      kimiConfig: cfg,
      log: { warn: () => {}, debug: () => {}, info: () => {}, error: () => {} },
      modelProvider: {
        resolveProviderConfig: (alias: string) => ({
          modelAlias: alias,
          providerName: 'test-provider',
          provider: { type: 'kimi', model: alias },
        }),
        resolveAuth: () => undefined,
      },
    };
    await probeModelAlias(agent as never, 'broken');
    const rows = selectFleetCatalogRows(cfg);
    expect(rows.map((r) => r.alias)).not.toContain('broken');
    expect(rows.map((r) => r.alias)).toContain('ok');
  });
});
