import { describe, expect, it } from 'vitest';

import {
  CredentialHealthStore,
  annotateModelsWithCredentialHealth,
  credentialHealthCacheKey,
} from '../src/credential-health';

describe('CredentialHealthStore', () => {
  it('treats unknown credentials as available', () => {
    const store = new CredentialHealthStore(new Map());
    expect(store.isAvailable('xai-grok')).toBe(true);
    expect(store.failureReason('xai-grok')).toBeUndefined();
  });

  it('marks auth rejected with cooldown then recovers after expiry', () => {
    const store = new CredentialHealthStore(new Map());
    const now = 1_000_000;
    store.markAuthRejected('xai-grok', {
      credentialKey: 'acct-a',
      cooldownMs: 60_000,
      now,
      failureReason: 'rejected',
    });
    expect(store.isAvailable('xai-grok', 'acct-a', now + 1)).toBe(false);
    expect(store.failureReason('xai-grok', 'acct-a', now + 1)).toBe('rejected');
    expect(store.isAvailable('xai-grok', 'acct-a', now + 60_001)).toBe(true);
  });

  it('markHealthy clears unavailability', () => {
    const store = new CredentialHealthStore(new Map());
    store.markAuthRejected('openai', { failureReason: 'bad' });
    expect(store.isAvailable('openai')).toBe(false);
    store.markHealthy('openai');
    expect(store.isAvailable('openai')).toBe(true);
  });

  it('builds stable cache keys', () => {
    expect(credentialHealthCacheKey('xai-grok', 'a')).toBe('xai-grok::a');
    expect(credentialHealthCacheKey('xai-grok')).toBe('xai-grok::default');
  });
});

describe('annotateModelsWithCredentialHealth', () => {
  it('marks models without credentials unavailable', () => {
    const store = new CredentialHealthStore(new Map());
    const rows = annotateModelsWithCredentialHealth(
      [
        { id: 'm1', provider: 'xai-grok', alias: 'fast' },
        { id: 'm2', provider: 'openai', alias: 'gpt' },
      ],
      {
        hasCredential: (providerId) => providerId === 'openai',
        store,
      },
    );
    expect(rows[0]?.available).toBe(false);
    expect(rows[0]?.failureReason).toBe('no_credential');
    expect(rows[1]?.available).toBe(true);
  });

  it('marks auth-unhealthy providers unavailable', () => {
    const store = new CredentialHealthStore(new Map());
    store.markAuthRejected('xai-grok', { failureReason: 'OAuth rejected' });
    const rows = annotateModelsWithCredentialHealth(
      [{ id: 'm1', provider: 'xai-grok', alias: 'grok' }],
      {
        hasCredential: () => true,
        store,
      },
    );
    expect(rows[0]?.available).toBe(false);
    expect(rows[0]?.failureReason).toContain('OAuth');
  });
});
