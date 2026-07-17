import { describe, expect, it } from 'vitest';

import {
  allocateProviderOAuthAccountKey,
  listProviderOAuthRefs,
  mergeProviderOAuthLogin,
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
});
