import { APIProviderRateLimitError, emptyUsage, type ChatProvider } from '@superliora/kosong';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLlmProviderCircuitObserver } from '../../src/agent/llm-provider-circuit-breaker';
import {
  InMemoryProviderRouteState,
  KosongLLM,
  type GenerateFn,
} from '../../src/agent/turn/kosong-llm';
import { CircuitBreakerRegistry } from '../../src/runtime/circuit-breaker';
import { ErrorCodes } from '../../src/errors';

function makeProvider(name: string, modelName: string): ChatProvider {
  return {
    name,
    modelName,
    thinkingEffort: null,
    async generate() {
      throw new Error('unused');
    },
    withThinking() {
      return this;
    },
  } as ChatProvider;
}

afterEach(() => vi.useRealTimers());

describe('KosongLLM circuit observer', () => {
  it('records failed provider health while closing the route circuit after actual fallback success', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const onChanged = vi.fn();
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const generate: GenerateFn = async (nextProvider) => {
      if (nextProvider.modelName === 'primary-model') {
        throw new APIProviderRateLimitError('rate limited', 'req-429');
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const route = {
      key: 'main-route',
      strategy: 'fallback' as const,
      candidates: [
        { modelAlias: 'primary', providerName: 'primary', provider: primaryProvider },
        { modelAlias: 'backup', providerName: 'backup', provider: backupProvider },
      ],
    };
    const llm = new KosongLLM({
      provider: primaryProvider,
      systemPrompt: 'system',
      generate,
      route,
      routeState: new InMemoryProviderRouteState(),
      circuitObserver: createLlmProviderCircuitObserver(registry, onChanged),
    });

    await llm.chat({ messages: [], tools: [], signal: new AbortController().signal });

    expect(registry.get('llm:primary').snapshot()).toMatchObject({
      failures: 1,
      state: 'open',
      lastTripReason: expect.stringContaining('rate_limit'),
    });
    expect(registry.get('llm:main-route').snapshot()).toMatchObject({
      failures: 0,
      state: 'closed',
    });
    expect(registry.get('llm:backup').snapshot()).toMatchObject({
      failures: 0,
      state: 'closed',
    });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('keeps failed provider and route circuits open until an explicit later request succeeds', async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 0, 1);
    vi.setSystemTime(now);
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const candidateProvider = makeProvider('native-circuit-provider', 'native-circuit-wire');
    const route = {
      key: 'native-circuit-route',
      strategy: 'fallback' as const,
      cooldownMs: 5_000,
      candidates: [{
        modelAlias: 'native-circuit-model',
        providerName: 'native-circuit-provider',
        provider: candidateProvider,
      }],
    };
    let fail = true;
    const generate = vi.fn<GenerateFn>(async () => {
      if (fail) throw new APIProviderRateLimitError('rate limited', 'req-429');
      return {
        id: 'provider-success',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], toolCalls: [] },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    });
    const llm = new KosongLLM({
      provider: candidateProvider,
      systemPrompt: 'system',
      generate,
      route,
      routeState: new InMemoryProviderRouteState(),
      circuitObserver: createLlmProviderCircuitObserver(registry),
    });
    await expect(llm.chat({ messages: [], tools: [], signal: new AbortController().signal })).rejects.toThrow('rate limited');
    for (const scope of ['llm:native-circuit-provider', 'llm:native-circuit-route']) {
      expect(registry.get(scope).snapshot()).toMatchObject({ failures: 1, state: 'open' });
    }
    await expect(llm.chat({ messages: [], tools: [], signal: new AbortController().signal })).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_RATE_LIMIT,
      details: { routeUnavailable: true },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    for (const scope of ['llm:native-circuit-provider', 'llm:native-circuit-route']) {
      expect(registry.get(scope).snapshot()).toMatchObject({ failures: 1, state: 'open' });
    }

    fail = false;
    vi.setSystemTime(now + 5_001);
    await llm.chat({ messages: [], tools: [], signal: new AbortController().signal });
    expect(generate).toHaveBeenCalledTimes(2);
    for (const scope of ['llm:native-circuit-provider', 'llm:native-circuit-route']) {
      expect(registry.get(scope).snapshot()).toMatchObject({ failures: 0, state: 'closed' });
    }
  });
});
