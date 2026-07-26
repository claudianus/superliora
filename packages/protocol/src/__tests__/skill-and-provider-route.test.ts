import { describe, expect, it } from 'vitest';

import { skillDescriptorSchema, skillSearchHitSchema } from '../skill';
import {
  providerRouteFailureKindSchema,
  providerRouteSelectionSchema,
  providerRouteStatusSchema,
} from '../providerRoute';

describe('protocol/skill — zod schemas', () => {
  it('skillDescriptorSchema accepts a minimal descriptor', () => {
    const desc = skillDescriptorSchema.parse({
      name: 'commit',
      description: 'commit staged changes',
      path: '/skills/commit',
      source: 'builtin',
    });
    expect(desc.name).toBe('commit');
  });

  it('skillDescriptorSchema rejects a missing name', () => {
    expect(() =>
      skillDescriptorSchema.parse({
        description: 'x',
        path: '/x',
        source: 'builtin',
      }),
    ).toThrow();
  });

  it('skillSearchHitSchema extends the descriptor with score and match_reason', () => {
    const hit = skillSearchHitSchema.parse({
      name: 'commit',
      description: 'commit staged changes',
      path: '/skills/commit',
      source: 'builtin',
      score: 0.92,
      match_reason: 'matches user intent',
    });
    expect(hit.score).toBe(0.92);
  });

  it('skillSearchHitSchema accepts an extended descriptor with optional risk/category', () => {
    const hit = skillSearchHitSchema.parse({
      name: 'commit',
      description: 'commit staged changes',
      path: '/skills/commit',
      source: 'builtin',
      score: 0.5,
      match_reason: 'r',
      risk: 'low',
      category: 'git',
      is_sub_skill: false,
    });
    expect(hit.risk).toBe('low');
    expect(hit.category).toBe('git');
  });
});

describe('protocol/providerRoute — zod schemas', () => {
  it('providerRouteFailureKindSchema accepts the canonical kind set', () => {
    for (const v of [
      'auth',
      'quota',
      'rate_limit',
      'server',
      'connection',
      'timeout',
      'empty',
    ]) {
      expect(providerRouteFailureKindSchema.parse(v)).toBe(v);
    }
    expect(() => providerRouteFailureKindSchema.parse('unknown')).toThrow();
  });

  it('providerRouteStatusSchema accepts a healthy status', () => {
    const status = providerRouteStatusSchema.parse({
      modelAlias: 'kimi-k2',
      strategy: 'auto',
      candidates: [
        {
          modelAlias: 'kimi-k2',
          providerName: 'kimi',
          providerModel: 'kimi-k2',
        },
      ],
    });
    expect(status.modelAlias).toBe('kimi-k2');
  });

  it('providerRouteSelectionSchema accepts a fully populated selection', () => {
    const selection = providerRouteSelectionSchema.parse({
      modelAlias: 'kimi-k2',
      providerName: 'kimi',
      providerModel: 'kimi-k2',
    });
    expect(selection.providerName).toBe('kimi');
  });
});
