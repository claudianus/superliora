import { describe, expect, it } from 'vitest';

import { overlayRouteRateLimits } from '../src/provider-usage/provider-usage-merge';
import { resolveUsageProviderKey } from '../src/provider-usage/provider-usage-key';
import type { AllProvidersUsageSnapshot, ProviderUsageSnapshot } from '../src/provider-usage/provider-usage-types';

function claudeSnap(): ProviderUsageSnapshot {
  return {
    providerKey: 'anthropic-oauth',
    displayName: 'Anthropic Claude',
    available: true,
    summary: { label: '5-hour limit', used: 58, limit: 100, resetHint: 'resets in 3h' },
    limits: [],
    fetchedAtMs: Date.now(),
    remainingDisplay: 'Claude 42% · 3h',
    kind: 'subscription',
    status: 'ok',
    source: 'oauth-api',
  };
}

function quota(providers: readonly ProviderUsageSnapshot[]): AllProvidersUsageSnapshot {
  return {
    providers,
    primaryProviderKey: providers[0]?.providerKey ?? null,
    worstRatio: 0.58,
    fetchedAtMs: Date.now(),
  };
}

describe('resolveUsageProviderKey', () => {
  it('maps catalog / wire names onto snapshot providerKeys', () => {
    expect(resolveUsageProviderKey('anthropic')).toBe('anthropic-oauth');
    expect(resolveUsageProviderKey('anthropic-oauth')).toBe('anthropic-oauth');
    expect(resolveUsageProviderKey('openai')).toBe('openai-codex');
    expect(resolveUsageProviderKey('openai_responses')).toBe('openai-codex');
    expect(resolveUsageProviderKey('openai-codex')).toBe('openai-codex');
    expect(resolveUsageProviderKey('xai')).toBe('xai-grok');
    expect(resolveUsageProviderKey('xai-grok')).toBe('xai-grok');
    expect(resolveUsageProviderKey('cursor')).toBe('cursor-oauth');
    expect(resolveUsageProviderKey('kimi')).toBe('managed:kimi-api');
    expect(resolveUsageProviderKey('openrouter')).toBe('openrouter');
    expect(resolveUsageProviderKey('managed:kimi-code')).toBe('managed:kimi-code');
  });
});

describe('overlayRouteRateLimits identity', () => {
  it('does not insert a second row when candidate.providerName is the catalog id', () => {
    const live = overlayRouteRateLimits(quota([claudeSnap()]), [
      {
        providerName: 'anthropic',
        rateLimits: [{ name: 'requests', limit: 50, remaining: 10 }],
      },
    ]);
    expect(live?.providers.map((p) => p.providerKey)).toEqual(['anthropic-oauth']);
    expect(live?.providers[0]?.remainingDisplay).toBe('Claude 42% · 3h');
  });
});
