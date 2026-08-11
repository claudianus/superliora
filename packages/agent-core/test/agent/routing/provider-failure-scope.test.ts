import { describe, expect, it } from 'vitest';

import {
  CURSOR_OAUTH_PROVIDER_ID,
  isCursorIncludedLaneModel,
  shouldMarkProviderCredential,
} from '../../../src/agent/routing/provider-failure-scope';

describe('shouldMarkProviderCredential', () => {
  it('marks auth for every provider including cursor-oauth', () => {
    expect(shouldMarkProviderCredential(CURSOR_OAUTH_PROVIDER_ID, 'auth')).toBe(true);
    expect(shouldMarkProviderCredential('openai', 'auth')).toBe(true);
  });

  it('never marks provider credential for empty or model_unavailable', () => {
    expect(shouldMarkProviderCredential('openai', 'empty')).toBe(false);
    expect(shouldMarkProviderCredential(CURSOR_OAUTH_PROVIDER_ID, 'empty')).toBe(false);
    expect(shouldMarkProviderCredential('openai', 'model_unavailable')).toBe(false);
  });

  it('keeps cursor-oauth quota/rate_limit/server alias-scoped', () => {
    for (const kind of ['quota', 'rate_limit', 'server', 'connection', 'timeout'] as const) {
      expect(shouldMarkProviderCredential(CURSOR_OAUTH_PROVIDER_ID, kind)).toBe(false);
    }
  });

  it('still marks non-cursor providers on quota/rate_limit', () => {
    expect(shouldMarkProviderCredential('openai', 'quota')).toBe(true);
    expect(shouldMarkProviderCredential('xai-grok', 'rate_limit')).toBe(true);
  });
});

describe('isCursorIncludedLaneModel', () => {
  it('matches Auto, Composer 2.5, and Grok 4.5 (included pool)', () => {
    expect(isCursorIncludedLaneModel('cursor-oauth/default')).toBe(true);
    expect(isCursorIncludedLaneModel('default')).toBe(true);
    expect(isCursorIncludedLaneModel('composer-2.5')).toBe(true);
    expect(isCursorIncludedLaneModel('cursor-oauth/composer-2.5-fast')).toBe(true);
    expect(isCursorIncludedLaneModel('cursor-oauth/cursor-grok-4.5-high')).toBe(true);
    expect(isCursorIncludedLaneModel('cursor-grok-4.5-high-fast')).toBe(true);
  });

  it('does not treat API-lane models as included', () => {
    expect(isCursorIncludedLaneModel('cursor-oauth/claude-opus-5-high')).toBe(false);
    expect(isCursorIncludedLaneModel('cursor-oauth/kimi-k3-high')).toBe(false);
    expect(isCursorIncludedLaneModel('grok-code-fast-1')).toBe(false);
  });
});
