import { describe, expect, it } from 'vitest';

import { formatProviderQuotaFooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import type { AllProvidersUsageSnapshot } from '@superliora/sdk';

function snapshot(
  remainingDisplay: string,
  remainingUsed = 58,
): AllProvidersUsageSnapshot {
  return {
    providers: [
      {
        providerKey: 'anthropic-oauth',
        displayName: 'Anthropic Claude',
        available: true,
        summary: { label: '5-hour limit', used: remainingUsed, limit: 100 },
        limits: [],
        fetchedAtMs: Date.now(),
        remainingDisplay,
        kind: 'subscription',
        status: 'ok',
        source: 'oauth-api',
      },
    ],
    primaryProviderKey: 'anthropic-oauth',
    worstRatio: remainingUsed / 100,
    fetchedAtMs: Date.now(),
  };
}

describe('formatProviderQuotaFooterBadge', () => {
  it('hides when remaining is unknown', () => {
    expect(formatProviderQuotaFooterBadge(null, 'plain', 'anthropic-oauth')).toBeNull();
    expect(formatProviderQuotaFooterBadge(snapshot(''), 'plain', 'anthropic-oauth')).toBeNull();
  });

  it('shows the active provider compact remaining string', () => {
    const badge = formatProviderQuotaFooterBadge(
      snapshot('Claude 42% · 3h'),
      'plain',
      'anthropic-oauth',
    );
    expect(badge?.text).toBe('Claude 42% · 3h');
    expect(badge?.severity).toBe('info');
  });

  it('uses worstRatio severity (≥70 warn, ≥90 danger)', () => {
    expect(
      formatProviderQuotaFooterBadge(snapshot('Claude 20% · 1h', 80), 'plain', 'anthropic-oauth')
        ?.severity,
    ).toBe('warning');
    expect(
      formatProviderQuotaFooterBadge(snapshot('Claude 8% · 10m', 92), 'plain', 'anthropic-oauth')
        ?.severity,
    ).toBe('danger');
  });

  it('does not invent a percentage when the snapshot has no remainingDisplay', () => {
    const empty: AllProvidersUsageSnapshot = {
      providers: [
        {
          providerKey: 'openrouter',
          displayName: 'OpenRouter',
          available: false,
          summary: null,
          limits: [],
          fetchedAtMs: Date.now(),
          remainingDisplay: '',
          status: 'unavailable',
        },
      ],
      primaryProviderKey: null,
      worstRatio: 0,
      fetchedAtMs: Date.now(),
    };
    expect(formatProviderQuotaFooterBadge(empty, 'plain', 'openrouter')).toBeNull();
  });
});
