import { describe, expect, it } from 'vitest';

import {
  allocateProviderOAuthAccountKey,
  fingerprintProviderOAuthRef,
  isValidProviderOAuthCredentialLabel,
  labelProviderOAuthRef,
  listProviderOAuthRefs,
  mergeProviderOAuthLogin,
  promoteProviderOAuthRef,
  promoteProviderOAuthSlot,
  removeProviderOAuthRef,
  rewriteProviderOAuthRefs,
} from '../src/provider-oauth-pool';

describe('provider oauth pool', () => {
  it('allocates the default key for the first account', () => {
    const ref = allocateProviderOAuthAccountKey('xai-grok', undefined, {
      defaultKey: 'xai-grok',
    });
    expect(ref).toEqual({ storage: 'file', key: 'xai-grok' });
  });

  it('allocates a distinct key when accounts already exist', () => {
    const provider = {
      oauth: { storage: 'file', key: 'xai-grok' },
    };
    const ref = allocateProviderOAuthAccountKey('xai-grok', provider, {
      defaultKey: 'xai-grok',
      now: () => 1_700_000_000_000,
      randomBytes: () => new Uint8Array([1, 2, 3, 4]),
    });
    expect(ref.key).toMatch(/^xai-grok-account-/);
    expect(ref.key).not.toBe('xai-grok');
  });

  it('merges an add-account login into the oauth pool', () => {
    const existing = {
      type: 'openai',
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      oauth: { storage: 'file', key: 'xai-grok' },
      customHeaders: { 'X-XAI-Token-Auth': 'xai-grok-cli' },
    };
    const merged = mergeProviderOAuthLogin(
      existing,
      { storage: 'file', key: 'xai-grok-account-abc' },
      {
        addAccount: true,
        type: 'openai',
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
        customHeaders: { 'X-XAI-Token-Auth': 'xai-grok-cli' },
      },
    );
    expect(merged['oauth']).toEqual({ storage: 'file', key: 'xai-grok-account-abc' });
    expect(merged['oauths']).toEqual([{ storage: 'file', key: 'xai-grok' }]);
    expect(listProviderOAuthRefs(merged).map((ref) => ref.key)).toEqual([
      'xai-grok-account-abc',
      'xai-grok',
    ]);
  });

  it('keeps fallbacks when refreshing the primary account', () => {
    const existing = {
      type: 'openai',
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      oauth: { storage: 'file', key: 'xai-grok-account-abc' },
      oauths: [{ storage: 'file', key: 'xai-grok' }],
    };
    const merged = mergeProviderOAuthLogin(
      existing,
      { storage: 'file', key: 'xai-grok-account-abc' },
      {
        addAccount: false,
        type: 'openai',
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      },
    );
    expect(merged['oauth']).toEqual({ storage: 'file', key: 'xai-grok-account-abc' });
    expect(merged['oauths']).toEqual([{ storage: 'file', key: 'xai-grok' }]);
  });

  it('rewrites primary + fallbacks and drops empty oauth fields', () => {
    const provider = {
      type: 'openai',
      baseUrl: 'https://example.test/v1',
      oauth: { storage: 'file' as const, key: 'a', label: 'alpha' },
      oauths: [{ storage: 'file' as const, key: 'b' }],
    };
    const rewritten = rewriteProviderOAuthRefs(provider, [
      { storage: 'file', key: 'b' },
      { storage: 'file', key: 'a', label: 'alpha' },
    ]);
    expect(rewritten['oauth']).toEqual({ storage: 'file', key: 'b' });
    expect(rewritten['oauths']).toEqual([{ storage: 'file', key: 'a', label: 'alpha' }]);
    // Single primary still writes oauths: [] so deep-merge clears stale fallbacks.
    expect(rewriteProviderOAuthRefs(provider, [{ storage: 'file', key: 'solo' }])).toEqual({
      type: 'openai',
      baseUrl: 'https://example.test/v1',
      oauth: { storage: 'file', key: 'solo' },
      oauths: [],
    });
    expect(rewriteProviderOAuthRefs(provider, [])).toEqual({
      type: 'openai',
      baseUrl: 'https://example.test/v1',
    });
  });

  it('promotes a fallback slot to primary', () => {
    expect(promoteProviderOAuthSlot(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b']);
    const provider = {
      oauth: { storage: 'file' as const, key: 'primary' },
      oauths: [
        { storage: 'file' as const, key: 'fallback-1' },
        { storage: 'file' as const, key: 'fallback-2', label: 'work' },
      ],
    };
    const promoted = promoteProviderOAuthRef(provider, 2);
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.alreadyPrimary).toBe(false);
    expect(listProviderOAuthRefs(promoted.provider).map((ref) => ref.key)).toEqual([
      'fallback-2',
      'primary',
      'fallback-1',
    ]);
    const already = promoteProviderOAuthRef(provider, 0);
    expect(already.ok && already.alreadyPrimary).toBe(true);
  });

  it('labels and unlabels oauth refs with shared validation', () => {
    expect(isValidProviderOAuthCredentialLabel('work')).toBe(true);
    expect(isValidProviderOAuthCredentialLabel('bad label')).toBe(false);
    const provider = {
      oauth: { storage: 'file' as const, key: 'primary' },
      oauths: [{ storage: 'file' as const, key: 'fallback', label: 'work' }],
    };
    const labeled = labelProviderOAuthRef(provider, 0, 'home');
    expect(labeled.ok).toBe(true);
    if (!labeled.ok) return;
    expect(listProviderOAuthRefs(labeled.provider)[0]?.label).toBe('home');

    const duplicate = labelProviderOAuthRef(provider, 0, 'work');
    expect(duplicate).toEqual({ ok: false, reason: 'duplicate_label' });

    const unlabeled = labelProviderOAuthRef(provider, 1, undefined);
    expect(unlabeled.ok).toBe(true);
    if (!unlabeled.ok) return;
    expect(listProviderOAuthRefs(unlabeled.provider)[1]?.label).toBeUndefined();
  });

  it('removes oauth refs and clears the last account', () => {
    const provider = {
      type: 'openai',
      oauth: { storage: 'file' as const, key: 'primary' },
      oauths: [{ storage: 'file' as const, key: 'fallback' }],
    };
    const removed = removeProviderOAuthRef(provider, 0);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.remaining).toBe(1);
    expect(listProviderOAuthRefs(removed.provider).map((ref) => ref.key)).toEqual(['fallback']);

    expect(removed.provider['oauths']).toEqual([]);
    const cleared = removeProviderOAuthRef(removed.provider, 0);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.remaining).toBe(0);
    expect(cleared.provider).toEqual({ type: 'openai' });
  });

  it('fingerprints oauth refs stably', () => {
    const fp = fingerprintProviderOAuthRef({
      storage: 'file',
      key: 'xai-grok',
      oauthHost: 'https://example.test',
    });
    expect(fp).toMatch(/^[a-f0-9]{12}$/);
    expect(
      fingerprintProviderOAuthRef({
        storage: 'file',
        key: 'xai-grok',
        oauthHost: 'https://example.test',
      }),
    ).toBe(fp);
  });
});
