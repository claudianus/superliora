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
import {
  clearModelsDevCacheForTests,
  setModelsDevDataForTests,
} from '../../../src/utils/model-presets';
import { APIEmptyResponseError, APIStatusError } from '@superliora/kosong';
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
    clearModelsDevCacheForTests();
    sharedCredentialHealthStore.clear();
    setLiveProbeRunnerForTests(async () => {});
  });
  afterEach(() => {
    resetModelRouteHealthStoreForTests();
    resetLiveProbeCacheForTests();
    clearModelsDevCacheForTests();
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

  it('lists the session default alias first when healthy', () => {
    const cfg = config({
      defaultModel: 'cheap',
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
    expect(rows[0]?.alias).toBe('cheap');
  });

  it('marks vision=yes from models.dev when saved capabilities omit image_in', () => {
    setModelsDevDataForTests({
      models: new Map([
        [
          'grok-4.5',
          {
            supportsVision: true,
            supportsTools: true,
            supportsReasoning: true,
            contextWindow: 500_000,
          },
        ],
      ]),
    });
    const cfg = config({
      providers: {
        'xai-grok': { type: 'openai' as const, apiKey: 'test-key' },
      },
      models: {
        'xai-grok/grok-4.5': {
          provider: 'xai-grok',
          model: 'grok-4.5',
          maxContextSize: 500_000,
          // Stale partial list — must not shadow models.dev multimodal.
          capabilities: ['thinking', 'tool_use'],
        },
      },
    });
    const text = renderFleetModelCatalog(cfg);
    expect(text).toContain('xai-grok/grok-4.5');
    // alias | q | value | $/M_in | tools | vision | …
    expect(text).toMatch(
      /xai-grok\/grok-4\.5 \| [^|\n]+ \| [^|\n]+ \| [^|\n]+ \| yes \| yes \|/,
    );
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

  it('hides only the failed alias after empty live probe (siblings stay)', async () => {
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      if (alias === 'broken') {
        throw new APIEmptyResponseError('empty response');
      }
    });
    const cfg = config({
      providers: {
        'test-provider': PROVIDER,
        'other-provider': { type: 'kimi' as const, apiKey: 'other-key' },
      },
      models: {
        broken: {
          provider: 'test-provider',
          model: 'broken',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
        sibling: {
          provider: 'test-provider',
          model: 'sibling',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
          cost: { input: 1 },
        },
        other: {
          provider: 'other-provider',
          model: 'other',
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
          providerName: cfg.models?.[alias]?.provider ?? 'test-provider',
          provider: { type: 'kimi', model: alias },
        }),
        resolveAuth: () => undefined,
      },
    };
    await probeModelAlias(agent as never, 'broken');
    const rows = selectFleetCatalogRows(cfg);
    expect(rows.map((r) => r.alias)).not.toContain('broken');
    expect(rows.map((r) => r.alias)).toContain('sibling');
    expect(rows.map((r) => r.alias)).toContain('other');
  });

  it('keeps cursor included-lane models after an API-lane quota probe fails', async () => {
    setLiveProbeRunnerForTests(async (_agent, alias) => {
      if (alias === 'cursor-oauth/claude-opus') {
        throw new APIStatusError(429, 'quota exceeded', 'req-429');
      }
    });
    const cfg = config({
      providers: {
        'cursor-oauth': { type: 'cursor' as const, apiKey: 'cursor-key' },
      },
      models: {
        'cursor-oauth/claude-opus': {
          provider: 'cursor-oauth',
          model: 'claude-opus',
          maxContextSize: 200_000,
          capabilities: ['tool_use'],
          cost: { input: 5 },
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
          capabilities: ['tool_use', 'image_in'],
          cost: { input: 2 },
        },
        'cursor-oauth/default': {
          provider: 'cursor-oauth',
          model: 'default',
          maxContextSize: 200_000,
          capabilities: ['tool_use'],
          cost: { input: 0 },
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
          providerName: 'cursor-oauth',
          provider: { type: 'cursor', model: alias },
        }),
        resolveAuth: () => undefined,
      },
    };
    await probeModelAlias(agent as never, 'cursor-oauth/claude-opus');
    const rows = selectFleetCatalogRows(cfg);
    const aliases = rows.map((r) => r.alias);
    expect(aliases).not.toContain('cursor-oauth/claude-opus');
    expect(aliases).toContain('cursor-oauth/default');
    expect(aliases).toContain('cursor-oauth/composer-2.5');
    expect(aliases).toContain('cursor-oauth/cursor-grok-4.5-high');
    // Included lane ranks ahead of remaining API-lane siblings when both healthy.
    const text = renderFleetModelCatalog(cfg);
    expect(text).toContain('Cursor included lane');
  });
});
