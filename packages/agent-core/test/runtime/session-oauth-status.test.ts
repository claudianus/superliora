import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
  SUPERLIORA_PROVIDER_NAME,
} from '@superliora/oauth';
import { afterEach, describe, expect, it } from 'vitest';

import type { LioraConfig } from '../../src/config';
import { buildSessionOAuthStatus } from '../../src/runtime/session-oauth-status';

describe('buildSessionOAuthStatus', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    dirs.length = 0;
  });

  it('returns undefined when no oauth pool is configured', async () => {
    const config: LioraConfig = {
      providers: {
        'managed:kimi-code': { type: 'kimi', apiKey: 'test-key' },
      },
      models: {},
    };
    await expect(
      buildSessionOAuthStatus({ config, homeDir: '/tmp/superliora', modelAlias: 'kimi' }),
    ).resolves.toBeUndefined();
  });

  it('derives pool size and proactive refresh schedule from provider oauth refs', async () => {
    const nowMs = 1_700_000_000_000;
    const config: LioraConfig = {
      defaultModel: 'kimi',
      providers: {
        [SUPERLIORA_PROVIDER_NAME]: {
          type: 'kimi',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
          oauths: [{ storage: 'file', key: 'oauth/kimi-code-account-b' }],
        },
      },
      models: {
        kimi: { provider: SUPERLIORA_PROVIDER_NAME, model: 'k2', max_context_size: 128_000 },
      },
    };

    const status = await buildSessionOAuthStatus({
      config,
      homeDir: '/tmp/superliora',
      modelAlias: 'kimi',
      nowMs,
    });

    expect(status).toEqual({
      poolSize: 2,
      nextRefreshAtMs: nowMs + OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
    });
  });

  it('uses token expiry threshold when sooner than proactive poll', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'superliora-oauth-status-'));
    dirs.push(homeDir);
    const credentialsDir = join(homeDir, 'credentials');
    await mkdir(credentialsDir, { recursive: true });
    const nowSec = 1_700_000_000;
    const nowMs = nowSec * 1000;
    await writeFile(
      join(credentialsDir, 'kimi-code.json'),
      JSON.stringify({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 400,
        expires_at: nowSec + 400,
      }),
      'utf8',
    );

    const config: LioraConfig = {
      defaultModel: 'kimi',
      providers: {
        [SUPERLIORA_PROVIDER_NAME]: {
          type: 'kimi',
          oauth: { storage: 'file', key: 'oauth/kimi-code' },
        },
      },
      models: {
        kimi: { provider: SUPERLIORA_PROVIDER_NAME, model: 'k2', max_context_size: 128_000 },
      },
    };

    const status = await buildSessionOAuthStatus({
      config,
      homeDir,
      modelAlias: 'kimi',
      nowMs,
    });

    expect(status?.poolSize).toBe(1);
    expect(status?.nextRefreshAtMs).toBeLessThan(nowMs + OAUTH_PROACTIVE_REFRESH_INTERVAL_MS);
    expect(status?.nextRefreshAtMs).toBeGreaterThan(nowMs);
  });
});
