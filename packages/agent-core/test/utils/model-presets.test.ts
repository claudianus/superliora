import { strict as assert } from 'node:assert';
import { CredentialHealthStore } from '@superliora/oauth';
import { describe, it } from 'vitest';

import {
  autoAssignRoleModels,
  autoAssignRoleModelsWithHealth,
  buildFallbackChain,
  classifyModelTier,
  clearModelsDevCacheForTests,
  isAuthOrCreditFailure,
  isHardExcludedForRole,
  lookupModelsDevModel,
  modelsDevLookupKeys,
  previewLoopRoleModelRouting,
  ROLE_PRESETS,
  scoreFromBenchmarks,
  scoreModelQuality,
  scoreModelValue,
  setModelsDevDataForTests,
  type ModelMetadata,
} from '../../src/utils/model-presets';

// Note: classifyModelTierWithData and autoAssignRoleModelsWithData require
// network access to models.dev; tested via classifyModelTier fallback path.

describe('model-presets — classifyModelTier', () => {
  it('classifies haiku as ultra-cheap', () => {
    assert.equal(classifyModelTier('claude-3-haiku'), 'ultra-cheap');
  });

  it('classifies sonnet as balanced (not cheap)', () => {
    assert.equal(classifyModelTier('claude-sonnet-4'), 'balanced');
    assert.equal(classifyModelTier('claude-3-sonnet'), 'balanced');
  });

  it('classifies gpt-4o as balanced', () => {
    assert.equal(classifyModelTier('gpt-4o'), 'balanced');
  });

  it('classifies opus as high', () => {
    assert.equal(classifyModelTier('claude-3-opus'), 'high');
  });

  it('classifies unknown as balanced', () => {
    assert.equal(classifyModelTier('some-unknown-model'), 'balanced');
  });
});

describe('model-presets — autoAssignRoleModels', () => {
  const availableModels: ModelMetadata[] = [
    { id: 'claude-3-haiku', provider: 'anthropic', tier: 'ultra-cheap', available: true },
    { id: 'claude-3-sonnet', provider: 'anthropic', tier: 'balanced', available: true },
    { id: 'gpt-4o', provider: 'openai', tier: 'balanced', available: true },
    { id: 'claude-3-opus', provider: 'anthropic', tier: 'high', available: true },
  ];

  it('assigns ultra-cheap model to compaction role', () => {
    const assignments = autoAssignRoleModels(availableModels);
    const compaction = assignments.compaction;
    assert.ok(compaction);
    assert.equal(compaction.modelId, 'claude-3-haiku');
    assert.equal(compaction.isFallback, false);
  });

  it('assigns high model to coding role', () => {
    const assignments = autoAssignRoleModels(availableModels);
    const coding = assignments.coding;
    assert.ok(coding);
    assert.equal(coding.modelId, 'claude-3-opus');
  });

  it('assigns high-tier model to planning role', () => {
    const assignments = autoAssignRoleModels(availableModels);
    const planning = assignments.planning;
    assert.ok(planning);
    assert.equal(planning.modelId, 'claude-3-opus');
    assert.equal(planning.isFallback, false);
  });

  it('user override takes precedence', () => {
    const assignments = autoAssignRoleModels(availableModels, {
      compaction: 'gpt-4o',
    });
    assert.equal(assignments.compaction!.modelId, 'gpt-4o');
    assert.equal(assignments.compaction!.reason, 'User override');
  });

  it('handles no available models gracefully', () => {
    const assignments = autoAssignRoleModels([]);
    assert.equal(assignments.compaction, undefined);
  });

  it('skips unavailable models', () => {
    const models: ModelMetadata[] = [
      { id: 'haiku', provider: 'anthropic', tier: 'ultra-cheap', available: false, failureReason: '401' },
      { id: 'sonnet', provider: 'anthropic', tier: 'cheap', available: true },
    ];
    const assignments = autoAssignRoleModels(models);
    // haiku unavailable → should pick sonnet as fallback for compaction
    assert.equal(assignments.compaction!.modelId, 'sonnet');
    assert.equal(assignments.compaction!.isFallback, true);
  });
});

describe('model-presets — buildFallbackChain', () => {
  const models: ModelMetadata[] = [
    { id: 'haiku', provider: 'anthropic', tier: 'ultra-cheap', available: true },
    { id: 'sonnet', provider: 'anthropic', tier: 'cheap', available: true },
    { id: 'opus', provider: 'anthropic', tier: 'high', available: true },
  ];

  it('builds chain starting with preferred tier for compaction', () => {
    const chain = buildFallbackChain('compaction', models);
    assert.equal(chain[0]!.id, 'haiku');
    assert.equal(chain[1]!.id, 'sonnet');
  });

  it('builds chain starting with preferred tier for coding', () => {
    const chain = buildFallbackChain('coding', models);
    assert.equal(chain[0]!.id, 'opus');
  });
});

describe('model-presets — isAuthOrCreditFailure', () => {
  it('detects 401 errors', () => {
    assert.ok(isAuthOrCreditFailure('401 Unauthorized'));
  });

  it('detects payment method errors', () => {
    assert.ok(isAuthOrCreditFailure('No payment method'));
  });

  it('detects credit/quota errors', () => {
    assert.ok(isAuthOrCreditFailure('quota exceeded'));
  });

  it('ignores non-auth errors', () => {
    assert.ok(!isAuthOrCreditFailure('timeout'));
    assert.ok(!isAuthOrCreditFailure('500 internal server error'));
  });
});

describe('model-presets — ROLE_PRESETS', () => {
  it('has presets for all 6 roles', () => {
    const roles = new Set(ROLE_PRESETS.map((p) => p.role));
    assert.ok(roles.has('compaction'));
    assert.ok(roles.has('exploration'));
    assert.ok(roles.has('completion'));
    assert.ok(roles.has('coding'));
    assert.ok(roles.has('planning'));
    assert.ok(roles.has('debugging'));
  });

  it('compaction prefers ultra-cheap', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'compaction');
    assert.equal(preset!.preferredTier, 'ultra-cheap');
  });

  it('planning prefers high', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'planning');
    assert.equal(preset!.preferredTier, 'high');
    assert.equal(preset!.fallbackTier, 'balanced');
    assert.equal(preset!.minContextWindow, 128_000);
  });
});

describe('model-presets — thinking levels', () => {
  it('compaction has minimal thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'compaction');
    assert.equal(preset!.thinkingLevel, 'minimal');
  });

  it('planning has max thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'planning');
    assert.equal(preset!.thinkingLevel, 'max');
  });

  it('debugging has max thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'debugging');
    assert.equal(preset!.thinkingLevel, 'max');
  });

  it('coding has high thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'coding');
    assert.equal(preset!.thinkingLevel, 'high');
  });

  it('exploration has low thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'exploration');
    assert.equal(preset!.thinkingLevel, 'low');
  });

  it('completion has medium thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'completion');
    assert.equal(preset!.thinkingLevel, 'medium');
  });
});

describe('model-presets — thinking level in assignments', () => {
  it('assignment includes thinking level from preset', () => {
    const models: ModelMetadata[] = [
      { id: 'claude-3-haiku', provider: 'anthropic', tier: 'ultra-cheap', available: true },
      { id: 'claude-3-opus', provider: 'anthropic', tier: 'high', available: true, supportsReasoning: true },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.compaction!.thinkingLevel, 'minimal');
    assert.equal(assignments.coding!.thinkingLevel, 'high');
    assert.equal(assignments.planning!.thinkingLevel, 'max');
    assert.equal(assignments.debugging!.thinkingLevel, 'max');
  });

  it('downgrades thinking level when model lacks reasoning support', () => {
    const models: ModelMetadata[] = [
      // opus without supportsReasoning flag (undefined = unknown, not false)
      { id: 'opus', provider: 'anthropic', tier: 'high', available: true, supportsReasoning: false },
    ];
    const assignments = autoAssignRoleModels(models);
    // planning wants 'max' but model doesn't support reasoning → downgrade to 'low'
    assert.equal(assignments.planning!.thinkingLevel, 'low');
  });

  it('keeps thinking level when model supports reasoning', () => {
    const models: ModelMetadata[] = [
      { id: 'opus', provider: 'anthropic', tier: 'high', available: true, supportsReasoning: true },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.planning!.thinkingLevel, 'max');
  });
});

describe('model-presets — classifyModelTier with pricing data', () => {
  it('classifies ultra-cheap by low price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 0.25 }),
      'ultra-cheap',
    );
  });

  it('classifies cheap by moderate price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 1.5 }),
      'cheap',
    );
  });

  it('classifies balanced by mid price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 5.0 }),
      'balanced',
    );
  });

  it('classifies high by expensive price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 15.0 }),
      'high',
    );
  });

  it('classifies ultra-high by very expensive price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 30.0 }),
      'ultra-high',
    );
  });

  it('falls back to name pattern when no pricing data', () => {
    assert.equal(classifyModelTier('claude-3-haiku'), 'ultra-cheap');
    assert.equal(classifyModelTier('claude-3-opus'), 'high');
  });
});

describe('model-presets — assignment includes cost info', () => {
  it('reason includes pricing when available', () => {
    const models: ModelMetadata[] = [
      { id: 'haiku', provider: 'anthropic', tier: 'ultra-cheap', available: true, inputCostPerM: 0.25 },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.ok(assignments.compaction!.reason.includes('$0.25'));
  });
});

describe('model-presets — autoAssignRoleModelsWithHealth', () => {
  it('skips auth-rejected providers when annotating availability', () => {
    const store = new CredentialHealthStore(new Map());
    store.markAuthRejected('xai-grok', { failureReason: 'rejected' });
    const assignments = autoAssignRoleModelsWithHealth(
      [
        { id: 'grok-4.5', alias: 'grok', provider: 'xai-grok', tier: 'high' },
        { id: 'gpt-4.1', alias: 'gpt', provider: 'openai', tier: 'balanced' },
      ],
      {
        hasCredential: (id) => id === 'openai' || id === 'xai-grok',
        store,
      },
    );
    for (const assignment of Object.values(assignments)) {
      if (assignment === undefined) continue;
      assert.notEqual(assignment.modelAlias ?? assignment.modelId, 'grok');
      assert.notEqual(assignment.modelId, 'grok-4.5');
    }
  });
});

describe('model-presets — models.dev benchmarks', () => {
  it('scoreFromBenchmarks weights SWE/Terminal/AA coding benches', () => {
    const result = scoreFromBenchmarks([
      { name: 'SWE-Bench Verified', score: 90 },
      { name: 'Terminal-Bench', score: 80 },
      { name: 'Artificial Analysis Coding Index', score: 30 },
      { name: 'Some Unknown Bench', score: 99 },
    ]);
    assert.ok(result);
    assert.equal(result.count, 3);
    assert.ok(result.score >= 70);
    assert.ok(result.score <= 100);
  });

  it('scoreModelQuality prefers benchmarkScore over family heuristics', () => {
    const withBench = scoreModelQuality('cheap-looking-nano', {
      family: 'nano',
      benchmarkScore: 88,
      benchmarkCount: 3,
      supportsTools: true,
    });
    const without = scoreModelQuality('cheap-looking-nano', {
      family: 'nano',
      supportsTools: true,
    });
    assert.ok(withBench > without);
    assert.ok(withBench >= 80);
  });

  it('scoreModelValue rises as cost falls for fixed quality', () => {
    assert.ok(scoreModelValue(80, 1) > scoreModelValue(80, 4));
  });

  it('classifyModelTier ignores non-positive subscription cost', () => {
    assert.equal(classifyModelTier('qwen3.8-max-preview', { inputCostPerM: 0 }), 'high');
    assert.equal(classifyModelTier('kimi-k2.5', { inputCostPerM: 0 }), 'cheap');
  });

  it('scoreModelQuality demotes stale kimi-k2.5 below newer kimi', () => {
    const stale = scoreModelQuality('kimi-k2.5', { supportsTools: true, supportsReasoning: true });
    const newer = scoreModelQuality('kimi-k2.6', { supportsTools: true, supportsReasoning: true });
    assert.ok(newer > stale);
  });

  it('autoAssign prefers higher benchmark quality within the same tier', () => {
    const models: ModelMetadata[] = [
      {
        id: 'cheap-weak',
        provider: 'p',
        tier: 'ultra-cheap',
        available: true,
        inputCostPerM: 0.1,
        qualityScore: 40,
        valueScore: 400,
        supportsTools: true,
        contextWindow: 128_000,
      },
      {
        id: 'cheap-strong',
        provider: 'p',
        tier: 'ultra-cheap',
        available: true,
        inputCostPerM: 0.2,
        qualityScore: 75,
        valueScore: 375,
        supportsTools: true,
        contextWindow: 128_000,
        benchmarkScore: 75,
        benchmarkCount: 2,
      },
    ];
    const assignments = autoAssignRoleModels(models);
    // Compaction is value-first, but quality floor + tools still apply;
    // both pass floors — value may pick either; coding must pick strong.
    assert.equal(assignments.coding?.modelId, 'cheap-strong');
  });

  it('autoAssign may pick deepseek when it is the best value', () => {
    const models: ModelMetadata[] = [
      {
        id: 'deepseek-v4-flash',
        provider: 'deepseek',
        tier: 'ultra-cheap',
        available: true,
        inputCostPerM: 0.01,
        qualityScore: 70,
        valueScore: 7000,
        supportsTools: true,
        contextWindow: 128_000,
      },
      {
        id: 'gemini-flash',
        provider: 'google',
        tier: 'ultra-cheap',
        available: true,
        inputCostPerM: 0.15,
        qualityScore: 60,
        valueScore: 400,
        supportsTools: true,
        contextWindow: 128_000,
      },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.compaction?.modelId, 'deepseek-v4-flash');
  });

  it('autoAssign honors deepseek user override', () => {
    const models: ModelMetadata[] = [
      {
        id: 'deepseek-v4-flash',
        alias: 'deepseek/flash',
        provider: 'deepseek',
        tier: 'ultra-cheap',
        available: true,
        supportsTools: true,
        contextWindow: 128_000,
      },
      {
        id: 'gemini-flash',
        provider: 'google',
        tier: 'ultra-cheap',
        available: true,
        supportsTools: true,
        contextWindow: 128_000,
      },
    ];
    const assignments = autoAssignRoleModels(models, { planning: 'deepseek/flash' });
    assert.equal(assignments.planning?.modelAlias, 'deepseek/flash');
    assert.equal(assignments.planning?.reason, 'User override');
  });

  it('prefers bench-backed grok-4.5 over heuristic grok-4.20 for coding roles', () => {
    const models: ModelMetadata[] = [
      {
        id: 'grok-4.20-0309-reasoning',
        alias: 'xai-grok/grok-4.20-0309-reasoning',
        provider: 'xai-grok',
        tier: 'high',
        available: true,
        supportsTools: true,
        supportsReasoning: true,
        contextWindow: 1_000_000,
        // Inflated family heuristic — must still lose to real benches.
        qualityScore: 100,
        valueScore: 33,
      },
      {
        id: 'grok-4.5',
        alias: 'xai-grok/grok-4.5',
        provider: 'xai-grok',
        tier: 'high',
        available: true,
        supportsTools: true,
        supportsReasoning: true,
        contextWindow: 500_000,
        qualityScore: 86,
        valueScore: 43,
        benchmarkScore: 82,
        benchmarkCount: 2,
        inputCostPerM: 2,
      },
      {
        id: 'grok-build-0.1',
        alias: 'xai-grok/grok-build-0.1',
        provider: 'xai-grok',
        tier: 'ultra-cheap',
        available: true,
        supportsTools: true,
        contextWindow: 256_000,
        qualityScore: 70,
        valueScore: 90,
        inputCostPerM: 1,
      },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.coding?.modelId, 'grok-4.5');
    assert.equal(assignments.planning?.modelId, 'grok-4.5');
    assert.equal(assignments.debugging?.modelId, 'grok-4.5');
    assert.ok(assignments.coding?.reason.includes('benches'));
    assert.equal(assignments.compaction?.modelId, 'grok-build-0.1');
  });

  it('caps heuristic quality below typical multi-bench flagships', () => {
    const heuristic = scoreModelQuality('grok-4.20-0309-reasoning', {
      supportsTools: true,
      supportsReasoning: true,
      supportsVision: true,
      contextWindow: 1_000_000,
    });
    const withBench = scoreModelQuality('grok-4.5', {
      supportsTools: true,
      supportsReasoning: true,
      benchmarkScore: 82,
      benchmarkCount: 2,
    });
    assert.ok(heuristic <= 84);
    assert.ok(withBench > heuristic);
  });

  it('classifies grok-4.5 as high and grok-build as ultra-cheap by name', () => {
    assert.equal(classifyModelTier('grok-4.5'), 'high');
    assert.equal(classifyModelTier('grok-4.20-0309-reasoning'), 'high');
    assert.equal(classifyModelTier('grok-build-0.1'), 'ultra-cheap');
  });
});

describe('model-presets — same-family generation ranking', () => {
  function grokFlagship(id: string, qualityScore: number, extra: Partial<ModelMetadata> = {}): ModelMetadata {
    return {
      id,
      alias: `xai-grok/${id}`,
      provider: 'xai-grok',
      family: 'grok',
      tier: 'high',
      available: true,
      supportsTools: true,
      supportsReasoning: true,
      contextWindow: 256_000,
      inputCostPerM: 2,
      qualityScore,
      valueScore: qualityScore / 2,
      benchmarkScore: qualityScore,
      benchmarkCount: 2,
      ...extra,
    };
  }

  it('picks the newer equal-price grok generation over 4.5 when live benches are close', () => {
    const models: ModelMetadata[] = [
      grokFlagship('grok-4.5', 86),
      grokFlagship('grok-4.6', 84),
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.coding?.modelId, 'grok-4.6');
    assert.equal(assignments.planning?.modelId, 'grok-4.6');
    assert.equal(assignments.debugging?.modelId, 'grok-4.6');
  });

  it('picks a later same-family generation when the catalog advances past 4.6', () => {
    const models: ModelMetadata[] = [
      grokFlagship('grok-4.6', 86),
      grokFlagship('grok-4.7', 84),
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.coding?.modelId, 'grok-4.7');
    assert.equal(assignments.planning?.modelId, 'grok-4.7');
  });

  it('still prefers grok-4.5 over grok-4 / grok-4.3 when no newer sibling is listed', () => {
    const models: ModelMetadata[] = [
      grokFlagship('grok-4', 80, { contextWindow: 128_000 }),
      grokFlagship('grok-4.3', 82),
      grokFlagship('grok-4.5', 86),
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.coding?.modelId, 'grok-4.5');
    assert.equal(assignments.planning?.modelId, 'grok-4.5');
    assert.equal(assignments.debugging?.modelId, 'grok-4.5');
  });

  it('still prefers a clearly cheaper value model for value roles', () => {
    const models: ModelMetadata[] = [
      grokFlagship('grok-4.6', 84, { valueScore: 42 }),
      {
        id: 'grok-build-0.1',
        alias: 'xai-grok/grok-build-0.1',
        provider: 'xai-grok',
        family: 'grok',
        tier: 'ultra-cheap',
        available: true,
        supportsTools: true,
        contextWindow: 256_000,
        inputCostPerM: 0.2,
        qualityScore: 70,
        valueScore: 350,
      },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.compaction?.modelId, 'grok-build-0.1');
    assert.equal(assignments.exploration?.modelId, 'grok-build-0.1');
    assert.equal(assignments.coding?.modelId, 'grok-4.6');
  });

  it('breaks remaining same-family ties with larger context, then the session default', () => {
    const sameGen: ModelMetadata[] = [
      grokFlagship('grok-4.6-compact', 84, { contextWindow: 128_000 }),
      grokFlagship('grok-4.6-wide', 84, { contextWindow: 1_000_000 }),
    ];
    const byContext = autoAssignRoleModels(sameGen);
    assert.equal(byContext.coding?.modelId, 'grok-4.6-wide');

    const sameContext: ModelMetadata[] = [
      grokFlagship('grok-4.6-a', 84, { contextWindow: 256_000 }),
      grokFlagship('grok-4.6-b', 84, { contextWindow: 256_000 }),
    ];
    const byDefault = autoAssignRoleModels(sameContext, undefined, { sessionDefault: 'grok-4.6-b' });
    assert.equal(byDefault.coding?.modelId, 'grok-4.6-b');
    assert.notEqual(byDefault.coding?.reason, 'User override');

    const newerStillWins: ModelMetadata[] = [
      grokFlagship('grok-4.6', 86),
      grokFlagship('grok-4.7', 84),
    ];
    const assignments = autoAssignRoleModels(newerStillWins, undefined, {
      sessionDefault: 'grok-4.6',
    });
    assert.equal(assignments.coding?.modelId, 'grok-4.7');
  });

  it('previewLoopRoleModelRouting prefers the newer equal-price grok generation', () => {
    const previews = previewLoopRoleModelRouting([
      {
        alias: 'xai-grok/grok-4.5',
        model: 'grok-4.5',
        provider: 'xai-grok',
        available: true,
        maxContextSize: 256_000,
        capabilities: ['thinking', 'tool_use'],
        inputCostPerM: 2,
      },
      {
        alias: 'xai-grok/grok-4.6',
        model: 'grok-4.6',
        provider: 'xai-grok',
        available: true,
        maxContextSize: 256_000,
        capabilities: ['thinking', 'tool_use'],
        inputCostPerM: 2,
      },
    ]);
    const coding = previews.find((row) => row.role === 'coding');
    const planning = previews.find((row) => row.role === 'planning');
    assert.equal(coding?.resolvedAlias, 'xai-grok/grok-4.6');
    assert.equal(planning?.resolvedAlias, 'xai-grok/grok-4.6');
  });
});

describe('model-presets — previewLoopRoleModelRouting health gate', () => {
  it('excludes available===false aliases from auto picks when healthy alternatives exist', () => {
    const previews = previewLoopRoleModelRouting([
      {
        alias: 'qwen-token-plan/qwen3.8-max-preview',
        model: 'qwen3.8-max-preview',
        provider: 'qwen-token-plan',
        available: false,
        maxContextSize: 1_000_000,
        capabilities: ['thinking', 'tool_use'],
        inputCostPerM: 0.5,
      },
      {
        alias: 'xai-grok/grok-4',
        model: 'grok-4',
        provider: 'xai-grok',
        available: true,
        maxContextSize: 256_000,
        capabilities: ['thinking', 'tool_use'],
        inputCostPerM: 3,
      },
      {
        alias: 'xai-grok/grok-fast',
        model: 'grok-fast',
        provider: 'xai-grok',
        available: true,
        maxContextSize: 128_000,
        capabilities: ['tool_use'],
        inputCostPerM: 0.2,
      },
    ]);

    for (const row of previews) {
      if (row.resolvedAlias !== undefined) {
        assert.notEqual(row.resolvedAlias.startsWith('qwen-token-plan/'), true);
        assert.equal(row.resolvedAlias.startsWith('xai-grok/'), true);
      }
    }
    const coding = previews.find((p) => p.role === 'coding');
    assert.ok(coding?.resolvedAlias);
    assert.equal(coding?.source, 'auto');
  });

  it('returns source none when every catalog entry is unavailable', () => {
    const previews = previewLoopRoleModelRouting([
      {
        alias: 'qwen-token-plan/qwen3.6-flash',
        model: 'qwen3.6-flash',
        provider: 'qwen-token-plan',
        available: false,
        maxContextSize: 1_000_000,
        capabilities: ['tool_use'],
      },
    ]);
    for (const row of previews) {
      assert.equal(row.resolvedAlias, undefined);
      assert.equal(row.source, 'none');
    }
  });
});

describe('model-presets — hard exclude + quality floor', () => {
  it('hard-excludes kimi-k2.5 from coding/planning/debugging', () => {
    assert.equal(isHardExcludedForRole('coding', 'kimi-k2.5'), true);
    assert.equal(isHardExcludedForRole('planning', 'kimi-k2'), true);
    assert.equal(isHardExcludedForRole('exploration', 'kimi-k2.5'), false);
  });

  it('does not assign kimi-k2.5 to coding when a stronger peer exists', () => {
    const models: ModelMetadata[] = [
      {
        id: 'kimi-k2.5',
        provider: 'kimi',
        tier: 'cheap',
        available: true,
        qualityScore: 70,
        valueScore: 140,
        supportsTools: true,
        contextWindow: 128_000,
      },
      {
        id: 'kimi-k2.6',
        provider: 'kimi',
        tier: 'high',
        available: true,
        qualityScore: 85,
        valueScore: 40,
        supportsTools: true,
        contextWindow: 256_000,
      },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.coding?.modelId, 'kimi-k2.6');
    assert.notEqual(assignments.coding?.modelId, 'kimi-k2.5');
  });

  it('coding quality floor does not soft-fall back to weak pool', () => {
    const models: ModelMetadata[] = [
      {
        id: 'weak-flash',
        provider: 'p',
        tier: 'high',
        available: true,
        qualityScore: 40,
        valueScore: 400,
        supportsTools: true,
        contextWindow: 128_000,
      },
      {
        id: 'ok-balanced',
        provider: 'p',
        tier: 'balanced',
        available: true,
        qualityScore: 80,
        valueScore: 20,
        supportsTools: true,
        contextWindow: 128_000,
      },
    ];
    const assignments = autoAssignRoleModels(models);
    // preferred high tier fails floor → fallback balanced that passes
    assert.equal(assignments.coding?.modelId, 'ok-balanced');
  });

  it('coding returns undefined when every candidate fails quality floor', () => {
    const models: ModelMetadata[] = [
      {
        id: 'weak-a',
        provider: 'p',
        tier: 'high',
        available: true,
        qualityScore: 30,
        valueScore: 300,
        supportsTools: true,
        contextWindow: 128_000,
      },
      {
        id: 'weak-b',
        provider: 'p',
        tier: 'balanced',
        available: true,
        qualityScore: 40,
        valueScore: 200,
        supportsTools: true,
        contextWindow: 128_000,
      },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.coding, undefined);
    assert.equal(assignments.planning, undefined);
  });
});

describe('model-presets — models.dev lookup', () => {
  it('strips Cursor effort suffixes to the catalog id', () => {
    assert.deepEqual(modelsDevLookupKeys('cursor-grok-4.5-high-fast'), [
      'cursor-grok-4.5-high-fast',
      'grok-4.5-high-fast',
      'grok-4.5',
    ]);
  });

  it('resolves vision from a warm models.dev row for a suffixed id', () => {
    clearModelsDevCacheForTests();
    setModelsDevDataForTests({
      models: new Map([['grok-4.5', { supportsVision: true, supportsTools: true }]]),
    });
    assert.equal(lookupModelsDevModel('cursor-grok-4.5-high')?.supportsVision, true);
    clearModelsDevCacheForTests();
  });
});
