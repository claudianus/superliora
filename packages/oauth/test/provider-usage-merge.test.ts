import { describe, expect, it } from 'vitest';

import { overlayRouteRateLimits } from '../src/provider-usage/provider-usage-merge';
import type { AllProvidersUsageSnapshot, ProviderUsageSnapshot } from '../src/provider-usage/provider-usage-types';

function accountSnapshot(
  overrides: Partial<ProviderUsageSnapshot> & { readonly providerKey: string },
): ProviderUsageSnapshot {
  return {
    displayName: overrides.providerKey,
    available: true,
    summary: { label: 'Weekly limit', used: 10, limit: 100 },
    limits: [],
    fetchedAtMs: Date.now(),
    source: 'response-headers',
    ...overrides,
  };
}

function quotaFixture(providers: readonly ProviderUsageSnapshot[]): AllProvidersUsageSnapshot {
  return {
    providers,
    primaryProviderKey: providers[0]?.providerKey ?? null,
    worstRatio: 0,
    fetchedAtMs: Date.now(),
  };
}

describe('overlayRouteRateLimits with account pools', () => {
  it('keeps every pool account when overlaying a candidate for another provider', () => {
    const quota = quotaFixture([
      accountSnapshot({
        providerKey: 'openai-codex',
        accountKey: 'codex-1',
        isPrimary: true,
        source: 'oauth-api',
      }),
      accountSnapshot({ providerKey: 'openai-codex', accountKey: 'codex-2' }),
    ]);
    const result = overlayRouteRateLimits(quota, [
      { providerName: 'deepseek', rateLimits: [{ name: 'Requests', limit: 100, remaining: 40 }] },
    ]);
    expect(result).not.toBeNull();
    expect(result!.providers).toHaveLength(3);
    expect(result!.providers.filter((snap) => snap.providerKey === 'openai-codex')).toHaveLength(2);
  });

  it('overlays response headers onto the primary account only', () => {
    const quota = quotaFixture([
      accountSnapshot({
        providerKey: 'xai-grok',
        accountKey: 'grok-1',
        isPrimary: true,
        source: 'response-headers',
      }),
      accountSnapshot({ providerKey: 'xai-grok', accountKey: 'grok-2', source: 'response-headers' }),
    ]);
    const result = overlayRouteRateLimits(quota, [
      { providerName: 'xai-grok', rateLimits: [{ name: 'Requests', limit: 200, remaining: 10 }] },
    ]);
    const accounts = result!.providers.filter((snap) => snap.providerKey === 'xai-grok');
    expect(accounts).toHaveLength(2);
    const primary = accounts.find((snap) => snap.isPrimary === true)!;
    const secondary = accounts.find((snap) => snap.isPrimary !== true)!;
    expect(primary.summary).toMatchObject({ label: 'Requests', used: 190, limit: 200 });
    expect(secondary.summary).toMatchObject({ label: 'Weekly limit', used: 10, limit: 100 });
  });

  it('builds a snapshot from route headers when no cached quota exists', () => {
    const result = overlayRouteRateLimits(null, [
      { providerName: 'groq', rateLimits: [{ name: 'Requests', limit: 50, remaining: 20 }] },
    ]);
    expect(result!.providers).toHaveLength(1);
    expect(result!.providers[0]).toMatchObject({ providerKey: 'groq', available: true });
    expect(result!.providers[0]!.summary).toMatchObject({ used: 30, limit: 50 });
  });
});
