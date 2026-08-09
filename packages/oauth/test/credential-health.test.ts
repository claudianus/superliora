import { afterEach, describe, expect, it } from 'vitest';

import {
  CredentialHealthStore,
  DEFAULT_QUOTA_COOLDOWN_MS,
  QUOTA_EXHAUSTED_FAILURE_REASON,
  applyUsageSnapshotsToCredentialHealth,
  canClearQuotaExhaustionFromUsage,
  credentialHealthCacheKey,
  isProviderUsageQuotaExhausted,
  sharedCredentialHealthStore,
} from '../src/credential-health';
import type { ProviderUsageSnapshot } from '../src/provider-usage/provider-usage-types';

function snap(
  partial: Partial<ProviderUsageSnapshot> & Pick<ProviderUsageSnapshot, 'providerKey'>,
): ProviderUsageSnapshot {
  return {
    displayName: partial.displayName ?? partial.providerKey,
    available: partial.available ?? true,
    summary: partial.summary ?? null,
    limits: partial.limits ?? [],
    error: partial.error,
    fetchedAtMs: partial.fetchedAtMs ?? 1_700_000_000_000,
    providerKey: partial.providerKey,
  };
}

describe('oauth/credential-health — credentialHealthCacheKey', () => {
  it('produces a deterministic, non-empty cache key for the same provider+credential', () => {
    const a = credentialHealthCacheKey('kimi', 'cred-A');
    const b = credentialHealthCacheKey('kimi', 'cred-A');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('differentiates by providerId', () => {
    expect(credentialHealthCacheKey('kimi', 'cred-A')).not.toBe(
      credentialHealthCacheKey('openai', 'cred-A'),
    );
  });

  it('differentiates by credentialKey', () => {
    expect(credentialHealthCacheKey('kimi', 'cred-A')).not.toBe(
      credentialHealthCacheKey('kimi', 'cred-B'),
    );
  });

  it('uses "default" as the credential key when omitted', () => {
    expect(credentialHealthCacheKey('kimi', undefined)).toBe(
      credentialHealthCacheKey('kimi', 'default'),
    );
  });

  it('trims surrounding whitespace from both inputs', () => {
    expect(credentialHealthCacheKey('  kimi  ', '  cred-A  ')).toBe(
      credentialHealthCacheKey('kimi', 'cred-A'),
    );
  });
});

describe('oauth/credential-health — usage snapshot bridge', () => {
  afterEach(() => {
    sharedCredentialHealthStore.clear();
  });

  it('detects used>=limit on summary and limit rows', () => {
    expect(
      isProviderUsageQuotaExhausted(
        snap({
          providerKey: 'qwen-token-plan',
          summary: { label: 'Tokens', used: 100, limit: 100 },
        }),
      ),
    ).toBe(true);
    expect(
      isProviderUsageQuotaExhausted(
        snap({
          providerKey: 'qwen-token-plan',
          summary: { label: 'Tokens', used: 50, limit: 100 },
          limits: [{ label: 'Requests', used: 20, limit: 20 }],
        }),
      ),
    ).toBe(true);
    expect(
      isProviderUsageQuotaExhausted(
        snap({
          providerKey: 'qwen-token-plan',
          summary: { label: 'Tokens', used: 1, limit: 100 },
        }),
      ),
    ).toBe(false);
  });

  it('detects clear quota-exhausted error text', () => {
    expect(
      isProviderUsageQuotaExhausted(
        snap({
          providerKey: 'qwen-token-plan',
          available: true,
          error: 'Rate limited — quota may be exhausted.',
        }),
      ),
    ).toBe(true);
    expect(
      isProviderUsageQuotaExhausted(
        snap({
          providerKey: 'qwen-token-plan',
          error: 'Request timed out.',
        }),
      ),
    ).toBe(false);
  });

  it('marks qwen-token-plan unavailable when usage is exhausted', () => {
    const store = new CredentialHealthStore(new Map());
    const now = 1_700_000_000_000;
    const result = applyUsageSnapshotsToCredentialHealth(
      [
        snap({
          providerKey: 'qwen-token-plan',
          summary: { label: 'Token Plan tokens', used: 1_000_000, limit: 1_000_000 },
        }),
      ],
      { store, now },
    );

    expect(result.exhausted).toEqual(['qwen-token-plan']);
    expect(store.isAvailable('qwen-token-plan', undefined, now)).toBe(false);
    expect(store.get('qwen-token-plan')).toMatchObject({
      status: 'rate_limited',
      failureReason: QUOTA_EXHAUSTED_FAILURE_REASON,
      cooldownUntil: now + DEFAULT_QUOTA_COOLDOWN_MS,
    });
  });

  it('marks alibaba-token-plan* family and ignores unrelated providers', () => {
    const store = new CredentialHealthStore(new Map());
    const result = applyUsageSnapshotsToCredentialHealth(
      [
        snap({
          providerKey: 'alibaba-token-plan-cn',
          limits: [{ label: 'Requests', used: 5, limit: 5 }],
        }),
        snap({
          providerKey: 'xai-grok',
          summary: { label: 'Requests', used: 100, limit: 100 },
        }),
      ],
      { store },
    );

    expect(result.exhausted).toEqual(['alibaba-token-plan-cn']);
    expect(result.skipped).toContain('xai-grok');
    expect(store.isAvailable('alibaba-token-plan-cn')).toBe(false);
    expect(store.isAvailable('xai-grok')).toBe(true);
  });

  it('does not overwrite a live auth_rejected record', () => {
    const store = new CredentialHealthStore(new Map());
    const now = 1_700_000_000_000;
    store.markAuthRejected('qwen-token-plan', {
      failureReason: 'invalid api key',
      now,
      cooldownMs: 10 * 60_000,
    });

    const result = applyUsageSnapshotsToCredentialHealth(
      snap({
        providerKey: 'qwen-token-plan',
        summary: { label: 'Tokens', used: 99, limit: 100 },
        error: 'Rate limited — quota may be exhausted.',
      }),
      { store, now: now + 1_000 },
    );

    expect(result.exhausted).toEqual([]);
    expect(result.skipped).toContain('qwen-token-plan');
    expect(store.get('qwen-token-plan')?.status).toBe('auth_rejected');
    expect(store.get('qwen-token-plan')?.failureReason).toBe('invalid api key');
  });

  it('clears prior quota_exhausted when a successful under-limit snapshot arrives', () => {
    const store = new CredentialHealthStore(new Map());
    const now = 1_700_000_000_000;
    store.markQuotaExhausted('qwen-token-plan', { now });

    expect(
      canClearQuotaExhaustionFromUsage(
        snap({
          providerKey: 'qwen-token-plan',
          available: true,
          summary: { label: 'Tokens', used: 10, limit: 100 },
        }),
      ),
    ).toBe(true);

    const result = applyUsageSnapshotsToCredentialHealth(
      snap({
        providerKey: 'qwen-token-plan',
        available: true,
        summary: { label: 'Tokens', used: 10, limit: 100 },
      }),
      { store, now: now + 5_000 },
    );

    expect(result.cleared).toEqual(['qwen-token-plan']);
    expect(store.isAvailable('qwen-token-plan', undefined, now + 5_000)).toBe(true);
    expect(store.get('qwen-token-plan')?.status).toBe('healthy');
  });

  it('accepts AllProvidersUsageSnapshot aggregate shape', () => {
    const store = new CredentialHealthStore(new Map());
    applyUsageSnapshotsToCredentialHealth(
      {
        providers: [
          snap({
            providerKey: 'alibaba-token-plan',
            error: 'insufficient quota',
          }),
        ],
        primaryProviderKey: null,
        worstRatio: 1,
        fetchedAtMs: Date.now(),
      },
      { store },
    );
    expect(store.isAvailable('alibaba-token-plan')).toBe(false);
  });

  it('shared store markQuotaExhausted is visible to isAvailable readers', () => {
    sharedCredentialHealthStore.markQuotaExhausted('qwen-token-plan');
    expect(sharedCredentialHealthStore.isAvailable('qwen-token-plan')).toBe(false);
    expect(sharedCredentialHealthStore.failureReason('qwen-token-plan')).toBe(
      QUOTA_EXHAUSTED_FAILURE_REASON,
    );
  });
});
