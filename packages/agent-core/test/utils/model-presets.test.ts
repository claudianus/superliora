import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  autoAssignRoleModels,
  buildFallbackChain,
  classifyModelTier,
  isAuthOrCreditFailure,
  ROLE_PRESETS,
  type ModelMetadata,
} from '../../src/utils/model-presets';

// Note: classifyModelTierWithData and autoAssignRoleModelsWithData require
// network access to models.dev; tested via classifyModelTier fallback path.

describe('model-presets — classifyModelTier', () => {
  test('classifies haiku as ultra-cheap', () => {
    assert.equal(classifyModelTier('claude-3-haiku'), 'ultra-cheap');
  });

  test('classifies sonnet as cheap', () => {
    assert.equal(classifyModelTier('claude-3-sonnet'), 'cheap');
  });

  test('classifies gpt-4o as balanced', () => {
    assert.equal(classifyModelTier('gpt-4o'), 'balanced');
  });

  test('classifies opus as high', () => {
    assert.equal(classifyModelTier('claude-3-opus'), 'high');
  });

  test('classifies unknown as balanced', () => {
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

  test('assigns ultra-cheap model to compaction role', () => {
    const assignments = autoAssignRoleModels(availableModels);
    const compaction = assignments.compaction;
    assert.ok(compaction);
    assert.equal(compaction!.modelId, 'claude-3-haiku');
    assert.equal(compaction!.isFallback, false);
  });

  test('assigns high model to coding role', () => {
    const assignments = autoAssignRoleModels(availableModels);
    const coding = assignments.coding;
    assert.ok(coding);
    assert.equal(coding!.modelId, 'claude-3-opus');
  });

  test('assigns ultra-high model to planning role with fallback to high', () => {
    const assignments = autoAssignRoleModels(availableModels);
    const planning = assignments.planning;
    assert.ok(planning);
    // No ultra-high model available, so should fallback to high
    assert.equal(planning!.modelId, 'claude-3-opus');
    assert.equal(planning!.isFallback, true);
  });

  test('user override takes precedence', () => {
    const assignments = autoAssignRoleModels(availableModels, {
      compaction: 'gpt-4o',
    });
    assert.equal(assignments.compaction!.modelId, 'gpt-4o');
    assert.equal(assignments.compaction!.reason, 'User override');
  });

  test('handles no available models gracefully', () => {
    const assignments = autoAssignRoleModels([]);
    assert.equal(assignments.compaction, undefined);
  });

  test('skips unavailable models', () => {
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

  test('builds chain starting with preferred tier for compaction', () => {
    const chain = buildFallbackChain('compaction', models);
    assert.equal(chain[0]!.id, 'haiku');
    assert.equal(chain[1]!.id, 'sonnet');
  });

  test('builds chain starting with preferred tier for coding', () => {
    const chain = buildFallbackChain('coding', models);
    assert.equal(chain[0]!.id, 'opus');
  });
});

describe('model-presets — isAuthOrCreditFailure', () => {
  test('detects 401 errors', () => {
    assert.ok(isAuthOrCreditFailure('401 Unauthorized'));
  });

  test('detects payment method errors', () => {
    assert.ok(isAuthOrCreditFailure('No payment method'));
  });

  test('detects credit/quota errors', () => {
    assert.ok(isAuthOrCreditFailure('quota exceeded'));
  });

  test('ignores non-auth errors', () => {
    assert.ok(!isAuthOrCreditFailure('timeout'));
    assert.ok(!isAuthOrCreditFailure('500 internal server error'));
  });
});

describe('model-presets — ROLE_PRESETS', () => {
  test('has presets for all 6 roles', () => {
    const roles = ROLE_PRESETS.map((p) => p.role);
    assert.ok(roles.includes('compaction'));
    assert.ok(roles.includes('exploration'));
    assert.ok(roles.includes('completion'));
    assert.ok(roles.includes('coding'));
    assert.ok(roles.includes('planning'));
    assert.ok(roles.includes('debugging'));
  });

  test('compaction prefers ultra-cheap', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'compaction');
    assert.equal(preset!.preferredTier, 'ultra-cheap');
  });

  test('planning prefers ultra-high', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'planning');
    assert.equal(preset!.preferredTier, 'ultra-high');
  });
});

describe('model-presets — thinking levels', () => {
  test('compaction has minimal thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'compaction');
    assert.equal(preset!.thinkingLevel, 'minimal');
  });

  test('planning has max thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'planning');
    assert.equal(preset!.thinkingLevel, 'max');
  });

  test('debugging has max thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'debugging');
    assert.equal(preset!.thinkingLevel, 'max');
  });

  test('coding has high thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'coding');
    assert.equal(preset!.thinkingLevel, 'high');
  });

  test('exploration has low thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'exploration');
    assert.equal(preset!.thinkingLevel, 'low');
  });

  test('completion has medium thinking', () => {
    const preset = ROLE_PRESETS.find((p) => p.role === 'completion');
    assert.equal(preset!.thinkingLevel, 'medium');
  });
});

describe('model-presets — thinking level in assignments', () => {
  test('assignment includes thinking level from preset', () => {
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

  test('downgrades thinking level when model lacks reasoning support', () => {
    const models: ModelMetadata[] = [
      // opus without supportsReasoning flag (undefined = unknown, not false)
      { id: 'opus', provider: 'anthropic', tier: 'high', available: true, supportsReasoning: false },
    ];
    const assignments = autoAssignRoleModels(models);
    // planning wants 'max' but model doesn't support reasoning → downgrade to 'low'
    assert.equal(assignments.planning!.thinkingLevel, 'low');
  });

  test('keeps thinking level when model supports reasoning', () => {
    const models: ModelMetadata[] = [
      { id: 'opus', provider: 'anthropic', tier: 'high', available: true, supportsReasoning: true },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.equal(assignments.planning!.thinkingLevel, 'max');
  });
});

describe('model-presets — classifyModelTier with pricing data', () => {
  test('classifies ultra-cheap by low price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 0.25 }),
      'ultra-cheap',
    );
  });

  test('classifies cheap by moderate price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 1.5 }),
      'cheap',
    );
  });

  test('classifies balanced by mid price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 5.0 }),
      'balanced',
    );
  });

  test('classifies high by expensive price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 15.0 }),
      'high',
    );
  });

  test('classifies ultra-high by very expensive price', () => {
    assert.equal(
      classifyModelTier('unknown-model', { inputCostPerM: 30.0 }),
      'ultra-high',
    );
  });

  test('falls back to name pattern when no pricing data', () => {
    assert.equal(classifyModelTier('claude-3-haiku'), 'ultra-cheap');
    assert.equal(classifyModelTier('claude-3-opus'), 'high');
  });
});

describe('model-presets — assignment includes cost info', () => {
  test('reason includes pricing when available', () => {
    const models: ModelMetadata[] = [
      { id: 'haiku', provider: 'anthropic', tier: 'ultra-cheap', available: true, inputCostPerM: 0.25 },
    ];
    const assignments = autoAssignRoleModels(models);
    assert.ok(assignments.compaction!.reason.includes('$0.25'));
  });
});