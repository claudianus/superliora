import { strict as assert } from 'node:assert';
import { CredentialHealthStore } from '@superliora/oauth';
import { describe, it } from 'vitest';

import {
  autoAssignRoleModels,
  autoAssignRoleModelsWithHealth,
  buildFallbackChain,
  classifyModelTier,
  isAuthOrCreditFailure,
  ROLE_PRESETS,
  scoreFromBenchmarks,
  scoreModelQuality,
  scoreModelValue,
  type ModelMetadata,
} from '../../src/utils/model-presets';

// Note: classifyModelTierWithData and autoAssignRoleModelsWithData require
// network access to models.dev; tested via classifyModelTier fallback path.

describe('model-presets — classifyModelTier', () => {
  it('classifies haiku as ultra-cheap', () => {
    assert.equal(classifyModelTier('claude-3-haiku'), 'ultra-cheap');
  });

  it('classifies sonnet as cheap', () => {
    assert.equal(classifyModelTier('claude-3-sonnet'), 'cheap');
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
    { id: 'claude-3-sonnet', provider: 'anthropic', tier: 'cheap', available: true },
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
});
