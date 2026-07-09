import { describe, expect, it } from 'vitest';

import { oauthProviderCatalogId } from '#/tui/utils/oauth-catalog-id';

describe('oauthProviderCatalogId', () => {
  it('maps OAuth provider ids to their models.dev catalog keys', () => {
    expect(oauthProviderCatalogId('xai-grok')).toBe('xai');
    expect(oauthProviderCatalogId('openai-codex')).toBe('openai');
  });

  it('passes through unknown ids unchanged', () => {
    expect(oauthProviderCatalogId('managed:kimi-api')).toBe('managed:kimi-api');
  });
});
