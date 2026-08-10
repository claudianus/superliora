import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sharedCredentialHealthStore } from '@superliora/oauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  advanceSmartRoute,
  classifySessionRole,
  classifyTurnRouting,
  defaultIntensityForRole,
  escalateIntensity,
  isConfigAliasHealthy,
  mergeRouteFallbackAliases,
  resetModelRouteHealthStoreForTests,
  resolveSessionSmartRoute,
  resolveSmartRoute,
  sharedModelRouteHealthStore,
  type SmartRoute,
} from '../../../src/agent/routing';
import {
  recordRouteOutcome,
  resetRouteOutcomeStoreForTests,
} from '../../../src/agent/routing/route-outcome';
import type { LioraConfig } from '../../../src/config';

const PROVIDER = {
  type: 'kimi' as const,
  apiKey: 'test-key',
};

function model(
  name: string,
  inputCost: number,
  maxContextSize = 128_000,
): {
  provider: string;
  model: string;
  maxContextSize: number;
  capabilities: readonly string[];
  cost: { input: number };
  fallbackModels?: string[];
} {
  return {
    provider: 'test-provider',
    model: name,
    maxContextSize,
    capabilities: ['tool_use', 'thinking'],
    cost: { input: inputCost },
  };
}

function config(partial: Partial<LioraConfig> & { models: LioraConfig['models'] }): LioraConfig {
  return {
    providers: { 'test-provider': PROVIDER },
    ...partial,
  } as LioraConfig;
}

describe('smart-router', () => {
  beforeEach(() => {
    resetRouteOutcomeStoreForTests(join(mkdtempSync(join(tmpdir(), 'sr-')), 'outcomes.json'));
    resetModelRouteHealthStoreForTests();
  });

  afterEach(() => {
    resetModelRouteHealthStoreForTests();
  });

  it('honors explicit loopControl override and builds fallbackModels chain', () => {
    const cfg = config({
      models: {
        pinned: { ...model('pinned-model', 5), fallbackModels: ['cheap-haiku'] },
        'cheap-haiku': model('cheap-haiku', 0.1),
        opus: model('opus', 10),
      },
      loopControl: { codingModel: 'pinned' },
    });

    const route = resolveSmartRoute({ role: 'coding', config: cfg });
    expect(route).toMatchObject({
      alias: 'pinned',
      source: 'explicit',
      intensity: 'balanced',
    });
    expect(route?.chain).toEqual(['pinned', 'cheap-haiku']);
  });

  it('auto-picks exploration value-first and coding quality-first', () => {
    const cfg = config({
      models: {
        'cheap-haiku': model('cheap-haiku', 0.1),
        opus: model('opus', 10),
      },
    });

    expect(resolveSmartRoute({ role: 'exploration', config: cfg })?.alias).toBe('cheap-haiku');
    expect(resolveSmartRoute({ role: 'coding', config: cfg })?.alias).toBe('opus');
  });

  it('advanceSmartRoute walks the chain', () => {
    const route: SmartRoute = {
      role: 'coding',
      intensity: 'balanced',
      alias: 'a',
      chain: ['a', 'b', 'c'],
      thinkingLevel: 'high',
      source: 'auto',
      reason: 'test',
    };
    expect(advanceSmartRoute(route, 'a')).toBe('b');
    expect(advanceSmartRoute(route, 'c')).toBeUndefined();
  });

  it('mergeRouteFallbackAliases puts smart chain ahead of config fallbacks', () => {
    const route: SmartRoute = {
      role: 'coding',
      intensity: 'max',
      alias: 'primary',
      chain: ['primary', 'mid'],
      thinkingLevel: 'high',
      source: 'auto',
      reason: 'test',
    };
    expect(
      mergeRouteFallbackAliases(route, ['config-fb', 'mid'], 'primary', () => true),
    ).toEqual(['mid', 'config-fb']);
  });

  it('classifies debug prompts to debugging/max and explore to exploration/value', () => {
    expect(
      classifyTurnRouting({
        roleHint: 'coding',
        signals: { prompt: 'fix this TypeError stack trace' },
        defaultIntensity: 'balanced',
      }),
    ).toMatchObject({ role: 'debugging', intensity: 'max' });

    expect(
      classifyTurnRouting({
        roleHint: 'coding',
        signals: { prompt: 'find where auth is configured', readOnly: true },
        defaultIntensity: 'balanced',
      }),
    ).toMatchObject({ role: 'exploration', intensity: 'value' });

    expect(classifySessionRole('implement multi-file patch')).toBe('coding');
    expect(classifySessionRole('니 추천대로 개선 진행해')).toBe('completion');
    expect(defaultIntensityForRole('planning')).toBe('max');
    expect(escalateIntensity('value')).toBe('balanced');
  });

  it('conductor session auto skips prompt-role demotion (orchestrator picker)', () => {
    const cfg = config({
      models: {
        'cheap-haiku': model('cheap-haiku', 0.1),
        opus: model('opus', 10),
      },
    });
    // Korean task-like text classifies as completion — but Conductor must stay coding.
    expect(classifySessionRole('니 추천대로 개선 진행해')).toBe('completion');
    const orch = resolveSessionSmartRoute({
      config: cfg,
      prompt: '니 추천대로 개선 진행해',
      profileName: 'conductor',
    });
    expect(orch?.role).toBe('coding');
    expect(orch?.intensity).toBe('balanced');
    expect(orch?.reason).toMatch(/conductor-orch/);

    // Explore-shaped prompts must not demote the Conductor orch lane either.
    const explorePrompt = resolveSessionSmartRoute({
      config: cfg,
      prompt: 'find where auth is configured',
      profileName: 'conductor',
    });
    expect(explorePrompt?.role).toBe('coding');

    // Non-conductor sessions still use prompt classification.
    const plain = resolveSessionSmartRoute({
      config: cfg,
      prompt: '니 추천대로 개선 진행해',
    });
    expect(plain?.role).toBe('completion');
  });

  it('outcome EMA can promote a head candidate over catalog pick', () => {
    const cfg = config({
      models: {
        'cheap-haiku': model('cheap-haiku', 0.1),
        'cheap-flash': model('cheap-flash', 0.12),
      },
    });
    for (let i = 0; i < 8; i += 1) {
      recordRouteOutcome({ role: 'exploration', alias: 'cheap-flash', ok: true });
      recordRouteOutcome({ role: 'exploration', alias: 'cheap-haiku', ok: false });
    }
    const route = resolveSmartRoute({ role: 'exploration', config: cfg });
    expect(route?.alias).toBe('cheap-flash');
  });

  it('budget overage steps intensity down', () => {
    const cfg = config({
      models: {
        'cheap-haiku': model('cheap-haiku', 0.1),
        opus: model('opus', 10),
      },
      loopControl: { smartRouterBudgetUsd: 1 },
    });
    const route = resolveSmartRoute({
      role: 'debugging',
      config: cfg,
      sessionSpendUsd: 2,
    });
    expect(route?.intensity).toBe('balanced');
  });

  it('treats missing provider as unhealthy', () => {
    const cfg = {
      models: {
        orphan: {
          provider: 'ghost',
          model: 'ghost-model',
          maxContextSize: 128_000,
          capabilities: ['tool_use'],
        },
      },
      providers: {},
    } as LioraConfig;
    expect(isConfigAliasHealthy(cfg, 'orphan')).toBe(false);
    expect(resolveSmartRoute({ role: 'coding', config: cfg })).toBeUndefined();
  });

  it('excludes oauth-only providers without a cached token', () => {
    const home = mkdtempSync(join(tmpdir(), 'sr-oauth-'));
    const prevHome = process.env['SUPERLIORA_HOME'];
    process.env['SUPERLIORA_HOME'] = home;
    try {
      const cfg = {
        models: {
          'oauth-model': {
            provider: 'cursor-oauth',
            model: 'gpt-5',
            maxContextSize: 128_000,
            capabilities: ['tool_use', 'thinking'],
            cost: { input: 5 },
          },
          'cheap-haiku': model('cheap-haiku', 0.1),
        },
        providers: {
          'cursor-oauth': {
            type: 'cursor' as const,
            oauth: { storage: 'file' as const, key: 'cursor-oauth' },
          },
          'test-provider': PROVIDER,
        },
      } as LioraConfig;
      expect(isConfigAliasHealthy(cfg, 'oauth-model')).toBe(false);
      expect(resolveSmartRoute({ role: 'coding', config: cfg })?.alias).toBe('cheap-haiku');
    } finally {
      if (prevHome === undefined) delete process.env['SUPERLIORA_HOME'];
      else process.env['SUPERLIORA_HOME'] = prevHome;
    }
  });

  it('degrades unhealthy explicit override to healthy fallback', () => {
    const cfg = config({
      models: {
        pinned: {
          ...model('pinned-model', 5),
          provider: 'broken',
          fallbackModels: ['cheap-haiku'],
        },
        'cheap-haiku': model('cheap-haiku', 0.1),
      },
      providers: {
        'test-provider': PROVIDER,
        broken: { type: 'kimi' as const },
      },
      loopControl: { codingModel: 'pinned' },
    });
    const route = resolveSmartRoute({ role: 'coding', config: cfg });
    expect(route).toMatchObject({
      alias: 'cheap-haiku',
      source: 'explicit',
      chain: ['cheap-haiku'],
    });
    expect(route?.reason).toMatch(/degraded/);
  });

  it('falls through to auto when explicit override chain is empty', () => {
    const cfg = config({
      models: {
        pinned: {
          ...model('pinned-model', 5),
          provider: 'broken',
        },
        opus: model('opus', 10),
      },
      providers: {
        'test-provider': PROVIDER,
        broken: { type: 'kimi' as const },
      },
      loopControl: { codingModel: 'pinned' },
    });
    const route = resolveSmartRoute({ role: 'coding', config: cfg });
    expect(route).toMatchObject({ alias: 'opus', source: 'auto' });
  });

  it('rejects unhealthy parent fallback', () => {
    const cfg = {
      models: {},
      providers: {},
    } as LioraConfig;
    expect(
      resolveSmartRoute({
        role: 'coding',
        config: cfg,
        parentAlias: 'missing-parent',
      }),
    ).toBeUndefined();
  });

  describe('quota-exhausted provider health', () => {
    afterEach(() => {
      sharedCredentialHealthStore.clear();
    });

    it('skips qwen-token-plan aliases when shared health is quota-exhausted', () => {
      sharedCredentialHealthStore.markQuotaExhausted('qwen-token-plan');

      const cfg = {
        models: {
          'qwen3.8-max': {
            provider: 'qwen-token-plan',
            model: 'qwen3.8-max',
            maxContextSize: 128_000,
            capabilities: ['tool_use', 'thinking'],
            cost: { input: 0.5 },
          },
          'cheap-haiku': model('cheap-haiku', 0.1),
        },
        providers: {
          'qwen-token-plan': {
            type: 'openai' as const,
            apiKey: 'qwen-key',
            baseUrl: 'https://token-plan.example/v1',
          },
          'test-provider': PROVIDER,
        },
      } as LioraConfig;

      expect(isConfigAliasHealthy(cfg, 'qwen3.8-max')).toBe(false);
      expect(isConfigAliasHealthy(cfg, 'cheap-haiku')).toBe(true);
      expect(resolveSmartRoute({ role: 'coding', config: cfg })?.alias).toBe('cheap-haiku');
    });
  });

  describe('alias-scoped model route health', () => {
    it('skips a marked-dead alias but keeps sibling models on the same provider', () => {
      sharedModelRouteHealthStore.markUnavailable('dead', {
        kind: 'model_unavailable',
        failureReason: 'model_not_found',
      });

      const cfg = config({
        models: {
          dead: model('retired-sku', 8),
          live: model('opus', 10),
        },
      });

      expect(isConfigAliasHealthy(cfg, 'dead')).toBe(false);
      expect(isConfigAliasHealthy(cfg, 'live')).toBe(true);
      expect(resolveSmartRoute({ role: 'coding', config: cfg })?.alias).toBe('live');
    });
  });
});

