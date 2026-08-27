import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolvePromptCacheKey, type LioraConfig } from '../../src/config';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { ProviderManager } from '../../src/session/provider/provider-manager';
import type { ModelProvider } from '../../src/session/provider/provider-manager-types';
import { testKaos } from '../fixtures/test-kaos';

const CACHE_CONFIG: LioraConfig = {
  defaultModel: 'kimi-code/kimi-for-coding',
  providers: {
    'managed:kimi-code': {
      type: 'kimi',
      apiKey: 'test-key',
      baseUrl: 'https://api.example/v1',
    },
  },
  models: {
    'kimi-code/kimi-for-coding': {
      provider: 'managed:kimi-code',
      model: 'kimi-for-coding',
      maxContextSize: 1_000_000,
    },
  },
};

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('Session agent prompt_cache_key', () => {
  it('pins Job workers to sessionId:agentId and leaves Conductor on the session key', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'liora-cache-key-'));
    tempDirs.push(sessionDir);

    const manager = new ProviderManager({
      config: CACHE_CONFIG,
      promptCacheKey: () => resolvePromptCacheKey('sess-abc', CACHE_CONFIG),
    });
    const session = new Session({
      id: 'sess-abc',
      kaos: testKaos,
      homedir: sessionDir,
      rpc: createSessionRpc(),
      initializeMainAgent: false,
      providerManager: manager,
      skills: { explicitDirs: [join(sessionDir, 'missing-skills')] },
    });

    const main = await session.createAgent({ type: 'main' });
    const worker = await session.createAgent({ type: 'sub' }, { parentAgentId: main.id });
    const sibling = await session.createAgent({ type: 'sub' }, { parentAgentId: main.id });

    expect(main.agent.modelProvider).toBe(manager);
    expect(cacheKey(main.agent.modelProvider)).toBe('sess-abc');
    expect(worker.agent.modelProvider).not.toBe(manager);
    expect(cacheKey(worker.agent.modelProvider)).toBe(`sess-abc:${worker.id}`);
    expect(cacheKey(sibling.agent.modelProvider)).toBe(`sess-abc:${sibling.id}`);
    expect(cacheKey(worker.agent.modelProvider)).not.toBe(cacheKey(sibling.agent.modelProvider));
  });
});

function cacheKey(provider: ModelProvider | undefined): string | undefined {
  if (provider === undefined) return undefined;
  const resolved = provider.resolveProviderConfig('kimi-code/kimi-for-coding');
  const kwargs = (resolved.provider as { generationKwargs?: { prompt_cache_key?: unknown } })
    .generationKwargs;
  const value = kwargs?.prompt_cache_key;
  return typeof value === 'string' ? value : undefined;
}

function createSessionRpc(): SDKSessionRPC {
  return new Proxy(
    {},
    {
      get: () => vi.fn(),
    },
  ) as SDKSessionRPC;
}
