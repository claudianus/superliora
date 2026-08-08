import { describe, expect, it } from 'vitest';

import {
  inferCheapModelAliasSync,
  inferCheapestModelAliasByCostSync,
  resolveCompactionModelAlias,
  resolveSubagentModelAlias,
} from '../../src/utils/cheap-model';

describe('resolveSubagentModelAlias', () => {
  const models = {
    'kimi-k2.5': { model: 'kimi-k2.5', provider: 'kimi' },
    'gemini-2.5-flash-lite': { model: 'gemini-2.5-flash-lite', provider: 'google' },
  };

  it('returns parent model for non-explore profiles', () => {
    expect(
      resolveSubagentModelAlias('coder', undefined, 'kimi-k2.5', models, 'gemini-2.5-flash-lite'),
    ).toBe('kimi-k2.5');
  });

  it('prefers explicit explorationModel for explore profiles', () => {
    expect(
      resolveSubagentModelAlias(
        'explore',
        undefined,
        'kimi-k2.5',
        models,
        'gemini-2.5-flash-lite',
      ),
    ).toBe('gemini-2.5-flash-lite');
  });

  it('falls back to inferred cheap model when explorationModel is unset', () => {
    expect(resolveSubagentModelAlias('explore', undefined, 'kimi-k2.5', models)).toBe(
      'gemini-2.5-flash-lite',
    );
  });

  it('falls back to parent model when no cheap model can be inferred', () => {
    expect(
      resolveSubagentModelAlias('explore', undefined, 'kimi-k2.5', {
        'kimi-k2.5': { model: 'kimi-k2.5' },
      }),
    ).toBe('kimi-k2.5');
  });

  it('treats profileBaseName explore as explore even when name differs', () => {
    expect(
      resolveSubagentModelAlias(
        'custom-scout',
        'explore',
        'kimi-k2.5',
        models,
        'gemini-2.5-flash-lite',
      ),
    ).toBe('gemini-2.5-flash-lite');
  });

  it('skips unhealthy explorationModel and cheap aliases', () => {
    const unhealthy = new Set(['gemini-2.5-flash-lite']);
    expect(
      resolveSubagentModelAlias(
        'explore',
        undefined,
        'kimi-k2.5',
        models,
        'gemini-2.5-flash-lite',
        {
          isAliasHealthy: (alias) => !unhealthy.has(alias),
        },
      ),
    ).toBe('kimi-k2.5');
  });

  // V7-2 (a): an explorationModel whose provider credentials are not entitled
  // (403 — marked unhealthy) must never be routed; explore falls back to the
  // cheap `fast` alias or the parent model instead.
  const modelsWithFast = {
    'kimi-k2.5': { model: 'kimi-k2.5', provider: 'kimi' },
    fast: { model: 'gemini-2.5-flash-lite', provider: 'google' },
    'explore-model': { model: 'explore-cheap', provider: 'opencode' },
  };

  it('(V7-2a) unauthorized explorationModel falls back to models.fast', () => {
    expect(
      resolveSubagentModelAlias(
        'explore',
        undefined,
        'kimi-k2.5',
        modelsWithFast,
        'explore-model',
        {
          isAliasHealthy: (alias) => alias !== 'explore-model',
        },
      ),
    ).toBe('fast');
  });

  it('(V7-2a) unauthorized explorationModel falls back to parent model without a healthy cheap alias', () => {
    expect(
      resolveSubagentModelAlias(
        'explore',
        undefined,
        'kimi-k2.5',
        modelsWithFast,
        'explore-model',
        {
          isAliasHealthy: (alias) => alias === 'kimi-k2.5',
        },
      ),
    ).toBe('kimi-k2.5');
  });

  it('inferCheapModelAliasSync skips unhealthy aliases', () => {
    expect(
      inferCheapModelAliasSync(models, (alias) => alias !== 'gemini-2.5-flash-lite'),
    ).toBeUndefined();
    expect(inferCheapModelAliasSync(models)).toBe('gemini-2.5-flash-lite');
  });
});

describe('inferCheapestModelAliasByCostSync / resolveCompactionModelAlias', () => {
  const priced = {
    'xai-grok/grok-4.5': {
      model: 'grok-4.5',
      provider: 'xai-grok',
      maxContextSize: 500_000,
      cost: { input: 2, output: 6 },
    },
    'deepseek/deepseek-v4-flash': {
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      maxContextSize: 128_000,
      cost: { input: 0.14, output: 0.28 },
    },
    'nvidia/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
      model: 'nemotron-3-nano-omni-30b-a3b-reasoning',
      provider: 'nvidia',
      maxContextSize: 32_000,
      // no cost — must not win over priced flash
    },
    'opencode-go/deepseek-v4-flash': {
      model: 'deepseek-v4-flash',
      provider: 'opencode-go',
      maxContextSize: 128_000,
      cost: { input: 0.14, output: 0.28 },
    },
  } as const;

  it('picks lowest local cost.input over expensive main models', () => {
    const alias = inferCheapestModelAliasByCostSync(priced);
    expect(alias).toBe('deepseek/deepseek-v4-flash');
  });

  it('skips aliases that fail the context window floor', () => {
    const alias = inferCheapestModelAliasByCostSync(priced, undefined, {
      minContextTokens: 200_000,
    });
    // only grok has 500k context among priced models
    expect(alias).toBe('xai-grok/grok-4.5');
  });

  it('skips unhealthy cost winners', () => {
    expect(
      inferCheapestModelAliasByCostSync(priced, (a) => !a.includes('deepseek')),
    ).toBe('xai-grok/grok-4.5');
  });

  it('resolveCompactionModelAlias prefers explicit override', () => {
    expect(
      resolveCompactionModelAlias({
        explicit: 'xai-grok/grok-4.5',
        models: priced,
      }),
    ).toBe('xai-grok/grok-4.5');
  });

  it('resolveCompactionModelAlias uses cost before name heuristics', () => {
    expect(resolveCompactionModelAlias({ models: priced })).toBe('deepseek/deepseek-v4-flash');
  });

  it('auto-picks deepseek when it is the cheapest priced alias', () => {
    const models = {
      'deepseek/flash': {
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
        cost: { input: 0.01, output: 0.02 },
        maxContextSize: 200_000,
      },
      'opencode/go': {
        model: 'opencode-go',
        provider: 'opencode',
        cost: { input: 0.02, output: 0.02 },
        maxContextSize: 200_000,
      },
      'google/flash': {
        model: 'gemini-2.5-flash',
        provider: 'google',
        cost: { input: 0.3, output: 1 },
        maxContextSize: 200_000,
      },
    };
    expect(inferCheapestModelAliasByCostSync(models)).toBe('deepseek/flash');
    expect(inferCheapModelAliasSync(models)).toBe('deepseek/flash');
  });

  it('resolveCompactionModelAlias falls back to name heuristic without cost', () => {
    const unpriced = {
      'main/big': { model: 'big', provider: 'p' },
      'p/gemini-flash': { model: 'gemini-flash', provider: 'p' },
    };
    expect(resolveCompactionModelAlias({ models: unpriced })).toBe('p/gemini-flash');
  });

  it('resolveCompactionModelAlias returns undefined when nothing matches', () => {
    expect(
      resolveCompactionModelAlias({
        models: { 'main/big': { model: 'big', provider: 'p' } },
      }),
    ).toBeUndefined();
  });
});
