/**
 * `ServicesManagedAuthFacade` (packages/agent-core/src/services/auth/managedAuth.ts)
 * routing tests.
 *
 * Regression coverage for the "No OAuth manager configured for provider
 * xai-grok" bug: non-Kimi OAuth providers (xAI Grok, OpenAI Codex) must route
 * through OAuthProviderManager at request time, not the Kimi-only toolkit.
 *
 * Integration-style: tokens are written to a temp credentials dir via
 * FileTokenStorage (the same storage backend OAuthProviderManager.login uses),
 * then the real facade is constructed against that homeDir. This verifies the
 * full path from config provider key → credential file → Bearer token without
 * mocking the routing decision itself.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FileTokenStorage,
  SUPERLIORA_PROVIDER_NAME,
  type TokenInfo,
} from '@superliora/oauth';

import { createManagedAuthFacade } from '../../src/services/auth/managedAuth';

function makeHomeDir(): string {
  return mkdtempSync(join(tmpdir(), 'managed-auth-'));
}

function makeToken(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    accessToken: 'grok-at-1',
    refreshToken: 'grok-rt-1',
    expiresAt: 2_000_000_000, // far future — never refreshes
    scope: 'openid profile email offline_access',
    tokenType: 'Bearer',
    expiresIn: 3600,
    ...overrides,
  };
}

async function seedToken(homeDir: string, providerId: string, token: TokenInfo): Promise<void> {
  const storage = new FileTokenStorage(join(homeDir, 'credentials'));
  // The credential file name must match OAuthProviderManager.storageName.
  await storage.save(providerId, token);
}

describe('ServicesManagedAuthFacade — non-Kimi OAuth routing', () => {
  it('getCachedAccessToken resolves an xai-grok token from disk (not the Kimi toolkit)', async () => {
    const homeDir = makeHomeDir();
    const configPath = join(homeDir, 'config.toml');
    const token = makeToken({ accessToken: 'grok-at-1' });
    await seedToken(homeDir, 'xai-grok', token);

    try {
      const facade = createManagedAuthFacade({ homeDir, configPath });
      const cached = await facade.getCachedAccessToken('xai-grok');
      expect(cached).toBe('grok-at-1');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('resolveOAuthTokenProvider returns a usable Bearer token for xai-grok', async () => {
    const homeDir = makeHomeDir();
    const configPath = join(homeDir, 'config.toml');
    const token = makeToken({ accessToken: 'grok-at-2' });
    await seedToken(homeDir, 'xai-grok', token);

    try {
      const facade = createManagedAuthFacade({ homeDir, configPath });
      const provider = facade.resolveOAuthTokenProvider('xai-grok');
      // This is the call made per-prompt-turn by ProviderManager.resolveAuth.
      // Before the fix this threw "No OAuth manager configured for provider
      // xai-grok".
      const accessToken = await provider!.getAccessToken();
      expect(accessToken).toBe('grok-at-2');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('logout removes the xai-grok credential file', async () => {
    const homeDir = makeHomeDir();
    const configPath = join(homeDir, 'config.toml');
    await seedToken(homeDir, 'xai-grok', makeToken());

    try {
      const facade = createManagedAuthFacade({ homeDir, configPath });
      expect(await facade.getCachedAccessToken('xai-grok')).toBeDefined();

      await facade.logout('xai-grok');

      expect(await facade.getCachedAccessToken('xai-grok')).toBeUndefined();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('applies the same routing to openai-codex', async () => {
    const homeDir = makeHomeDir();
    const configPath = join(homeDir, 'config.toml');
    await seedToken(homeDir, 'openai-codex', makeToken({ accessToken: 'codex-at-1' }));

    try {
      const facade = createManagedAuthFacade({ homeDir, configPath });
      const provider = facade.resolveOAuthTokenProvider('openai-codex');
      expect(await provider!.getAccessToken()).toBe('codex-at-1');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe('ServicesManagedAuthFacade — Kimi provider unchanged', () => {
  it('resolveOAuthTokenProvider still routes the managed Kimi provider through the toolkit', () => {
    const homeDir = makeHomeDir();
    const configPath = join(homeDir, 'config.toml');
    try {
      const facade = createManagedAuthFacade({ homeDir, configPath });
      // Without a persisted Kimi token this returns a provider whose
      // getAccessToken() would fail, but the routing itself must not throw
      // "No OAuth manager configured" — that only happens for non-Kimi names
      // routed into the toolkit.
      const provider = facade.resolveOAuthTokenProvider(SUPERLIORA_PROVIDER_NAME);
      expect(typeof provider!.getAccessToken).toBe('function');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
