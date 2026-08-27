import { describe, it, expect, beforeEach } from 'vitest';
import { isFreeModelId, isFreeModelMetadata, isFreeConfigAlias } from '../../src/utils/free-model';
import { resolveSmartRoute, buildLocalModelMetadata } from '../../src/agent/routing/smart-router';
import { sharedCredentialHealthStore } from '@superliora/oauth';
import { sharedModelRouteHealthStore } from '../../src/agent/routing/model-route-health';
import { validateConfig } from '../../src/config/schema';
import { configToTomlData } from '../../src/config/toml-serialize';
import { parseConfigString } from '../../src/config/toml';
import { stringify as stringifyToml } from 'smol-toml';

beforeEach(() => {
  sharedCredentialHealthStore.clear();
  sharedModelRouteHealthStore.clear();
});

describe('free-model detection', () => {
  it('detects free ids', () => {
    expect(isFreeModelId('x-preview-f-free')).toBe(true);
    expect(isFreeModelId('deepseek-v4-flash')).toBe(false);
    expect(isFreeModelId('opencode/deepseek-v4-flash-free')).toBe(true);
    expect(isFreeModelId('openrouter/qwen:free')).toBe(true);
    expect(isFreeModelId('gpt-4o')).toBe(false);
  });
  it('detects cost zero', () => {
    expect(isFreeModelMetadata({ id: 'test-model', provider: 'test', tier: 'balanced', available: true, inputCostPerM: 0 })).toBe(true);
    expect(isFreeModelMetadata({ id: 'test-model', provider: 'test', tier: 'balanced', available: true, inputCostPerM: 1 })).toBe(false);
  });
  it('detects alias config', () => {
    expect(isFreeConfigAlias('opencode/deepseek-v4-flash-free', {
      'opencode/deepseek-v4-flash-free': { provider: 'opencode', model: 'deepseek-v4-flash-free', maxContextSize: 100000 },
      'openai/gpt-4o': { provider: 'openai', model: 'gpt-4o', maxContextSize: 100000 },
    } as any)).toBe(true);
    expect(isFreeConfigAlias('openai/gpt-4o', {
      'opencode/deepseek-v4-flash-free': { provider: 'opencode', model: 'deepseek-v4-flash-free', maxContextSize: 100000 },
      'openai/gpt-4o': { provider: 'openai', model: 'gpt-4o', maxContextSize: 100000 },
    } as any)).toBe(false);
  });
});

describe('FREE mode routing (benchmark-aware)', () => {
  // Free models chosen to pass quality floors via family heuristics (opus/gpt-5) and to be tiered high
  const baseModels = {
    'opencode/claude-opus-4-free': { provider: 'opencode', model: 'claude-opus-4-free', maxContextSize: 262144 },
    'opencode/gpt-5-free': { provider: 'opencode', model: 'gpt-5-free', maxContextSize: 262144 },
    'opencode/deepseek-v4-pro-free': { provider: 'opencode', model: 'deepseek-v4-pro-free', maxContextSize: 1_000_000 },
    'openai/gpt-4o': { provider: 'openai', model: 'gpt-4o', maxContextSize: 128000 },
    'openai/gpt-4.1': { provider: 'openai', model: 'gpt-4.1', maxContextSize: 1047576 },
    'anthropic/claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4', maxContextSize: 200000 },
  };
  const baseProviders = {
    opencode: { type: 'openai' as const, baseUrl: 'https://opencode.ai/zen/v1', apiKey: 'test' },
    openai: { type: 'openai' as const, baseUrl: 'https://api.openai.com/v1', apiKey: 'test' },
    anthropic: { type: 'anthropic' as const, apiKey: 'test' },
  };
  it('FREE mode only picks free aliases per role (smart ranking, not dumb price)', () => {
    const configFree = validateConfig({ providers: baseProviders, models: baseModels, defaultModel: 'openai/gpt-4o', freeMode: true });
    for (const role of ['coding', 'planning', 'exploration', 'compaction', 'completion', 'debugging'] as const) {
      const route = resolveSmartRoute({ role, config: configFree });
      expect(route?.alias).toBeDefined();
      expect(isFreeModelId(route!.alias)).toBe(true);
    }
  });
  it('FREE mode relaxes quality floor for low-quality free pool (real Zen free tier)', () => {
    // Curated Zen free models have low heuristic quality (34-56) but FREE mode must still yield a coding model
    const lowFreeModels = {
      'opencode/x-preview-f-free': { provider: 'opencode', model: 'x-preview-f-free', maxContextSize: 262144 },
      'opencode/deepseek-v4-flash-free': { provider: 'opencode', model: 'deepseek-v4-flash-free', maxContextSize: 1_000_000 },
      'opencode/glm-4.7-free': { provider: 'opencode', model: 'glm-4.7-free', maxContextSize: 200000 },
      'openai/gpt-4o': { provider: 'openai', model: 'gpt-4o', maxContextSize: 128000 },
    };
    const configLowFree = validateConfig({ providers: baseProviders, models: lowFreeModels, defaultModel: 'openai/gpt-4o', freeMode: true });
    // Without relaxation, coding would be undefined (minQuality 72). With relaxation, picks best free by value/benchmark.
    const codingRoute = resolveSmartRoute({ role: 'coding', config: configLowFree });
    expect(codingRoute?.alias).toBeDefined();
    expect(isFreeModelId(codingRoute!.alias)).toBe(true);
    // Benchmark/tier-aware: coding prefers balanced/high tiers even when low quality; picks one of the balanced free models
    expect(['opencode/x-preview-f-free', 'opencode/glm-4.7-free', 'opencode/deepseek-v4-flash-free']).toContain(codingRoute!.alias);
    const explorationRoute = resolveSmartRoute({ role: 'exploration', config: configLowFree });
    expect(explorationRoute?.alias).toBeDefined();
    expect(isFreeModelId(explorationRoute!.alias)).toBe(true);
  });
  it('FREE mode filters buildLocalModelMetadata', () => {
    const configFree = validateConfig({ providers: baseProviders, models: baseModels, defaultModel: 'openai/gpt-4o', freeMode: true });
    const metaFree = buildLocalModelMetadata(configFree);
    expect(metaFree.every((m) => isFreeModelId(m.alias) || m.inputCostPerM === 0)).toBe(true);
    expect(metaFree.length).toBe(3);
    const configNormal = validateConfig({ providers: baseProviders, models: baseModels, defaultModel: 'openai/gpt-4o', freeMode: false });
    expect(buildLocalModelMetadata(configNormal).length).toBe(6);
  });
  it('degrades paid explicit overrides to free in FREE mode', () => {
    const configFreeOverridePaid = validateConfig({ providers: baseProviders, models: baseModels, defaultModel: 'openai/gpt-4o', freeMode: true, loopControl: { codingModel: 'openai/gpt-4o' } });
    const route = resolveSmartRoute({ role: 'coding', config: configFreeOverridePaid });
    expect(route?.alias).not.toBe('openai/gpt-4o');
    expect(isFreeModelId(route!.alias)).toBe(true);
  });
  it('keeps free explicit overrides', () => {
    const configFreeOverrideFree = validateConfig({ providers: baseProviders, models: baseModels, defaultModel: 'openai/gpt-4o', freeMode: true, loopControl: { codingModel: 'opencode/deepseek-v4-pro-free' } });
    const route = resolveSmartRoute({ role: 'coding', config: configFreeOverrideFree });
    expect(route?.alias).toBe('opencode/deepseek-v4-pro-free');
  });
  it('persists free_mode via TOML roundtrip', () => {
    const config = validateConfig({ providers: baseProviders, models: baseModels, defaultModel: 'openai/gpt-4o', freeMode: true });
    const tomlData = configToTomlData(config);
    expect(tomlData['free_mode']).toBe(true);
    const tomlText = stringifyToml(tomlData as Record<string, unknown>);
    expect(tomlText).toContain('free_mode = true');
    const reparsed = parseConfigString(tomlText);
    expect(reparsed.freeMode).toBe(true);
  });
  it('zero-cost models are considered free even without -free marker', () => {
    const zeroCostModels = {
      'provider/free-zero': { provider: 'provider', model: 'free-zero', maxContextSize: 100000, cost: { input: 0 } },
      'provider/paid-model': { provider: 'provider', model: 'paid-model', maxContextSize: 100000, cost: { input: 3 } },
    };
    const providers = { provider: { type: 'openai' as const, apiKey: 'test', baseUrl: 'https://api.test/v1' } };
    const config = validateConfig({ providers, models: zeroCostModels, defaultModel: 'provider/paid-model', freeMode: true });
    const meta = buildLocalModelMetadata(config);
    expect(meta.length).toBe(1);
    expect(meta[0]!.alias).toBe('provider/free-zero');
    const route = resolveSmartRoute({ role: 'exploration', config });
    expect(route?.alias).toBe('provider/free-zero');
  });
});
