import { describe, expect, it } from 'vitest';

import {
  modelCatalogItemSchema,
  providerCatalogItemSchema,
  providerCatalogStatusSchema,
  providerRefreshChangeSchema,
  providerRefreshFailureSchema,
} from '../modelCatalog';

describe('protocol/modelCatalog — zod schemas', () => {
  it('providerCatalogStatusSchema accepts the documented status values', () => {
    for (const v of ['connected', 'error', 'unconfigured']) {
      expect(providerCatalogStatusSchema.parse(v)).toBe(v);
    }
    expect(() => providerCatalogStatusSchema.parse('bogus')).toThrow();
  });

  it('modelCatalogItemSchema accepts a well-formed item', () => {
    const item = modelCatalogItemSchema.parse({
      provider: 'kimi',
      model: 'kimi-k2',
      display_name: 'Kimi K2',
      max_context_size: 131072,
      capabilities: ['tool_use', 'thinking'],
    });
    expect(item.model).toBe('kimi-k2');
  });

  it('modelCatalogItemSchema rejects a missing model', () => {
    expect(() =>
      modelCatalogItemSchema.parse({
        provider: 'kimi',
        max_context_size: 1000,
        capabilities: [],
      }),
    ).toThrow();
  });

  it('providerCatalogItemSchema accepts a complete item', () => {
    const item = providerCatalogItemSchema.parse({
      id: 'kimi',
      type: 'managed',
      has_api_key: true,
      status: 'connected',
    });
    expect(item.status).toBe('connected');
  });

  it('providerRefreshChangeSchema requires provider_id and provider_name', () => {
    expect(() =>
      providerRefreshChangeSchema.parse({
        provider_id: 'kimi',
        added: 0,
        removed: 0,
      }),
    ).toThrow();
    expect(() =>
      providerRefreshChangeSchema.parse({
        provider_name: 'kimi',
        added: 0,
        removed: 0,
      }),
    ).toThrow();
  });

  it('providerRefreshFailureSchema accepts a failure with provider + reason', () => {
    const item = providerRefreshFailureSchema.parse({
      provider: 'kimi',
      reason: 'RATE_LIMITED',
    });
    expect(item.reason).toBe('RATE_LIMITED');
  });
});
