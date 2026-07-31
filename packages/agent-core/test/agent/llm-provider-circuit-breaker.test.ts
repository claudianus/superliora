/**
 * LLM provider failover ↔ Agent.circuitBreakerRegistry wiring.
 */

import { APIProviderRateLimitError, emptyUsage, type ChatProvider } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import {
  attachLlmProviderCircuitBreakers,
  createLlmProviderCircuitObserver,
  llmProviderScopeId,
  llmRouteScopeId,
  recordLlmTurnProviderFailure,
  recordLlmTurnProviderSuccess,
} from '../../src/agent/llm-provider-circuit-breaker';
import { recoverFromProviderFailure } from '../../src/agent/turn/error-recovery';
import {
  InMemoryProviderRouteState,
  KosongLLM,
  type GenerateFn,
} from '../../src/agent/turn/kosong-llm';
import { CircuitBreakerRegistry } from '../../src/runtime/circuit-breaker';
import { ErrorCodes, toKimiErrorPayload } from '../../src/errors';
import { testKaos } from '../fixtures/test-kaos';
import * as retry from '../../src/loop/retry';

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

describe('llmProviderScopeId', () => {
  it('maps provider and route keys to llm: scopes', () => {
    expect(llmProviderScopeId('primary')).toBe('llm:primary');
    expect(llmRouteScopeId('k2')).toBe('llm:k2');
  });
});

describe('KosongLLM circuit observer', () => {
  it('records breaker failure on route failover and success on recovery', async () => {
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
});

describe('recoverFromProviderFailure circuit breaker', () => {
  it('records turn-level auto_retry failure and success on recovery', async () => {
    vi.spyOn(retry, 'sleepForRetry').mockResolvedValue(undefined);
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          primary: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-test',
            maxContextSize: 128_000,
          },
        },
      },
    });
    agent.config.update({ modelAlias: 'primary' });

    let attempts = 0;
    const throttled = toKimiErrorPayload(
      new APIProviderRateLimitError('Too Many Requests', 'req-429'),
    );
    const runOneTurn = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          event: {
            type: 'turn.ended' as const,
            turnId: 1,
            reason: 'failed' as const,
            durationMs: 1,
            error: throttled,
          },
        };
      }
      return {
        event: {
          type: 'turn.ended' as const,
          turnId: 1,
          reason: 'completed' as const,
          durationMs: 2,
        },
      };
    });

    const end = await recoverFromProviderFailure(
      { agent, runOneTurn },
      1,
      [],
      'user',
      new AbortController().signal,
      {
        event: {
          type: 'turn.ended',
          turnId: 1,
          reason: 'failed',
          durationMs: 0,
          error: throttled,
        },
      },
    );

    expect(end.event.reason).toBe('completed');
    expect(agent.circuitBreakerRegistry.get('llm:primary').snapshot()).toMatchObject({
      failures: 0,
      state: 'closed',
    });
    expect(runOneTurn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('records failure on auto_retry without tripping when below threshold', async () => {
    vi.spyOn(retry, 'sleepForRetry').mockResolvedValue(undefined);
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          openai: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' },
        },
        models: {
          main: {
            provider: 'openai',
            model: 'gpt-test',
            maxContextSize: 128_000,
          },
        },
      },
    });
    agent.config.update({ modelAlias: 'main' });

    const error = {
      code: ErrorCodes.PROVIDER_CONNECTION_ERROR,
      message: 'connection reset',
      retryable: true,
    };
    const runOneTurn = vi.fn(async () => ({
      event: {
        type: 'turn.ended' as const,
        turnId: 2,
        reason: 'failed' as const,
        durationMs: 1,
        error,
      },
    }));

    await recoverFromProviderFailure(
      { agent, runOneTurn },
      2,
      [],
      'user',
      new AbortController().signal,
      {
        event: {
          type: 'turn.ended',
          turnId: 2,
          reason: 'failed',
          durationMs: 0,
          error,
        },
      },
    );

    expect(agent.circuitBreakerRegistry.get('llm:openai').snapshot().failures).toBeGreaterThan(0);
    expect(agent.circuitBreakerRegistry.get('llm:main').snapshot().failures).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});

describe('recordLlmTurnProviderFailure/Success', () => {
  it('targets configured provider and route scopes', () => {
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          primary: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-test',
            maxContextSize: 128_000,
          },
        },
      },
    });
    agent.config.update({ modelAlias: 'primary' });

    recordLlmTurnProviderFailure(agent, {
      code: ErrorCodes.PROVIDER_RATE_LIMIT,
      message: '429 burst',
      retryable: true,
    });
    expect(agent.circuitBreakerRegistry.get('llm:primary').snapshot()).toMatchObject({
      failures: 1,
      state: 'closed',
    });

    recordLlmTurnProviderSuccess(agent);
    expect(agent.circuitBreakerRegistry.get('llm:primary').snapshot()).toMatchObject({
      failures: 0,
      state: 'closed',
    });
  });
});

describe('attachLlmProviderCircuitBreakers', () => {
  it('returns an observer bound to the agent registry', () => {
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          p: { type: 'openai', apiKey: 'key', defaultModel: 'm' },
        },
        models: {
          m: { provider: 'p', model: 'm', maxContextSize: 8_000 },
        },
      },
    });
    const observer = attachLlmProviderCircuitBreakers(agent);
    observer.onFailure({
      route: { key: 'm', strategy: 'fallback', candidates: [] },
      candidate: {
        modelAlias: 'm',
        providerName: 'p',
        provider: makeProvider('p', 'm'),
      },
      failure: { kind: 'server', cooldownMs: 30_000 },
      error: new Error('502'),
    });
    expect(agent.circuitBreakerRegistry.get('llm:p').snapshot().failures).toBe(1);
  });
});
