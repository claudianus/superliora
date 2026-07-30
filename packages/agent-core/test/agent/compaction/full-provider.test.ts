import type { ChatProvider, ModelCapability } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../../src/agent';
import {
  COMPACTION_MIN_OUTPUT_TOKENS,
  createCompactionProvider,
  type FullCompactionProviderHost,
} from '../../../src/agent/compaction/full-provider';

const CAPABILITY: ModelCapability = {
  image_in: false,
  video_in: false,
  audio_in: false,
  thinking: true,
  tool_use: true,
  max_context_tokens: 256_000,
};

function makeProvider(): ChatProvider {
  const thinkingOff = {
    name: 'mock-off',
    modelName: 'mock-model',
    thinkingEffort: null,
    generate: vi.fn(),
    withThinking: vi.fn(),
    withMaxCompletionTokens: vi.fn((n: number) => ({
      name: 'mock-capped',
      modelName: 'mock-model',
      thinkingEffort: null,
      generate: vi.fn(),
      withThinking: vi.fn(),
      withMaxCompletionTokens: vi.fn(),
      _cap: n,
    })),
  } as unknown as ChatProvider;
  return {
    name: 'mock',
    modelName: 'mock-model',
    thinkingEffort: 'high',
    generate: vi.fn(),
    withThinking: vi.fn(() => thinkingOff),
    withMaxCompletionTokens: vi.fn(),
  } as unknown as ChatProvider;
}

function makeHost(overrides: {
  readonly compactionModel?: string;
  readonly models?: Record<string, { provider: string; model: string }>;
  readonly resolveProviderConfig?: (alias: string) => unknown;
} = {}): FullCompactionProviderHost {
  const provider = makeProvider();
  const host: FullCompactionProviderHost = {
    compactionModelAlias: undefined,
    agent: {
      config: {
        modelAlias: 'main-model',
        modelCapabilities: CAPABILITY,
        provider,
        maxOutputSize: undefined,
      },
      kimiConfig: {
        loopControl: overrides.compactionModel === undefined
          ? undefined
          : { compactionModel: overrides.compactionModel },
        models: overrides.models,
      },
      modelProvider: overrides.resolveProviderConfig === undefined
        ? undefined
        : { resolveProviderConfig: overrides.resolveProviderConfig },
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as unknown as Agent,
  };
  return host;
}

describe('full-provider.ts — compaction summarizer provider', () => {
  it('exports a minimum output token floor for compaction', () => {
    expect(COMPACTION_MIN_OUTPUT_TOKENS).toBe(8_192);
  });

  it('disables thinking on the compaction provider', () => {
    const host = makeHost();
    const base = host.agent.config.provider as ChatProvider & {
      withThinking: ReturnType<typeof vi.fn>;
    };
    createCompactionProvider(host, 4_000);
    expect(base.withThinking).toHaveBeenCalledWith('off');
  });

  it('sets compactionModelAlias to the main model when no cheap alias is configured', () => {
    const host = makeHost();
    createCompactionProvider(host, 0);
    expect(host.compactionModelAlias).toBe('main-model');
  });

  it('uses an explicit loopControl.compactionModel alias when configured', () => {
    const host = makeHost({
      compactionModel: 'cheap-model',
      resolveProviderConfig: () => ({
        provider: { type: 'kimi', apiKey: 'test-key', model: 'cheap-model' },
        modelCapabilities: CAPABILITY,
      }),
    });
    createCompactionProvider(host, 1_000);
    expect(host.compactionModelAlias).toBe('cheap-model');
  });

  it('falls back to the main model when an inferred cheap alias fails to resolve', () => {
    const host = makeHost({
      models: {
        'main-model': { provider: 'p', model: 'kimi-k2' },
        'cheap-fast': { provider: 'p', model: 'claude-3-5-haiku' },
      },
      resolveProviderConfig: (alias) => {
        if (alias === 'cheap-fast') throw new Error('missing credentials');
        return {
          provider: { type: 'kimi', apiKey: 'test-key', model: alias },
          modelCapabilities: CAPABILITY,
        };
      },
    });
    createCompactionProvider(host, 2_000);
    expect(host.compactionModelAlias).toBe('main-model');
    expect(host.agent.log.warn).toHaveBeenCalled();
  });
});
