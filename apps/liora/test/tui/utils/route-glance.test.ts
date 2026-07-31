import { describe, expect, it } from 'vitest';

import { formatOpsRouteLine } from '#/tui/utils/model/route-glance';

describe('route-glance', () => {
  it('returns null when no route data exists', () => {
    expect(formatOpsRouteLine({})).toBeNull();
    expect(
      formatOpsRouteLine({
        providerRouteStatus: null,
        lastModelRouteNotice: null,
      }),
    ).toBeNull();
  });

  it('shows primary when providerRouteStatus is present', () => {
    expect(
      formatOpsRouteLine({
        providerRouteStatus: {
          modelAlias: 'gpt-test',
          strategy: 'fallback',
          candidates: [],
        },
      }),
    ).toBe('Route: primary');
  });

  it('shows failover line from lastModelRouteNotice', () => {
    expect(
      formatOpsRouteLine({
        providerRouteStatus: {
          modelAlias: 'gpt-test',
          strategy: 'fallback',
          candidates: [],
        },
        lastModelRouteNotice: {
          kind: 'failover',
          fromAlias: 'gpt-test',
          toAlias: 'cheap-model',
          reason: 'provider-failover',
          atMs: Date.now(),
        },
        availableModels: {
          'cheap-model': { model: 'cheap-model', displayName: 'Cheap Model', provider: 'mock' },
        },
      }),
    ).toBe('Route: failover→Cheap Model (provider-failover)');
  });

  it('omits reason parens when reason is empty', () => {
    expect(
      formatOpsRouteLine({
        lastModelRouteNotice: {
          kind: 'failover',
          toAlias: 'backup',
          atMs: Date.now(),
        },
      }),
    ).toBe('Route: failover→backup');
  });

  it('ignores non-failover notices without providerRouteStatus', () => {
    expect(
      formatOpsRouteLine({
        lastModelRouteNotice: {
          kind: 'selection',
          toAlias: 'gpt-test',
          reason: 'provider-credential',
          atMs: Date.now(),
        },
      }),
    ).toBeNull();
  });

  it('prefers failover over primary when both are present', () => {
    expect(
      formatOpsRouteLine({
        providerRouteStatus: {
          modelAlias: 'gpt-test',
          strategy: 'auto',
          candidates: [],
        },
        lastModelRouteNotice: {
          kind: 'failover',
          toAlias: 'fallback',
          reason: 'rate_limit',
          atMs: Date.now(),
        },
      }),
    ).toBe('Route: failover→fallback (rate_limit)');
  });
});
