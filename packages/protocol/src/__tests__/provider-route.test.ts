import { describe, expect, it } from 'vitest';

import {
  providerRouteFailureKindSchema,
  providerRouteSelectionSchema,
  providerRouteStatusSchema,
} from '../providerRoute';

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
