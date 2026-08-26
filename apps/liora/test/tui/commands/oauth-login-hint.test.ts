import { describe, expect, it } from 'vitest';

import { oauthLoginFollowUp } from '#/tui/commands/provider-connect/oauth-login-hint';

describe('oauthLoginFollowUp', () => {
  it('steers Anthropic OAuth failures to API key / cloud rows', () => {
    const hint = oauthLoginFollowUp('anthropic-oauth', new Error('invalid_client'));
    expect(hint).toContain('Anthropic');
    expect(hint).toContain('Bedrock');
    expect(hint).toContain('SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH=0');
  });

  it('points Cursor client-version errors at the env pin', () => {
    const hint = oauthLoginFollowUp('cursor-oauth', new Error('your client version is outdated'));
    expect(hint).toContain('SUPERLIORA_CURSOR_CLIENT_VERSION');
  });

  it('points xAI Build version errors at the grok CLI pin', () => {
    const hint = oauthLoginFollowUp('xai-grok', new Error('your grok cli is outdated'));
    expect(hint).toContain('SUPERLIORA_XAI_GROK_CLIENT_VERSION');
  });

  it('returns undefined for unrelated OAuth errors', () => {
    expect(oauthLoginFollowUp('openai-codex', new Error('network down'))).toBeUndefined();
  });
});
