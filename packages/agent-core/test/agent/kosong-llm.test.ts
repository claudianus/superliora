import {
  APIProviderRateLimitError,
  emptyUsage,
  type ChatProvider,
  type ModelCapability,
  type StreamedMessagePart,
  type ToolCall,
} from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryProviderRouteState,
  KosongLLM,
  type GenerateFn,
} from '../../src/agent/turn/kosong-llm';
import { ErrorCodes } from '../../src/errors';
import type { GenerateOptionsWithRequestLogFields } from '../../src/agent/llm-request-logger';
import type { ToolCallDelta } from '../../src/loop';

const provider: ChatProvider = {
  name: 'test',
  modelName: 'test-model',
  thinkingEffort: null,
  async generate() {
    throw new Error('generate should be injected by the test');
  },
  withThinking() {
    return this;
  },
};

describe('KosongLLM streaming tool-call deltas', () => {
  it('maps indexed argument deltas back to the provider tool call id', async () => {
    const deltas = await collectToolCallDeltas([
      {
        type: 'function',
        id: 'call_bash',
        name: 'Bash',
        arguments: null,
        _streamIndex: 0,
      },
      { type: 'tool_call_part', argumentsPart: '{"command"', index: 0 },
      { type: 'tool_call_part', argumentsPart: ':"pwd"}', index: 0 },
    ]);

    expect(deltas).toEqual([
      { toolCallId: 'call_bash', name: 'Bash' },
      { toolCallId: 'call_bash', name: 'Bash', argumentsPart: '{"command"' },
      { toolCallId: 'call_bash', name: 'Bash', argumentsPart: ':"pwd"}' },
    ]);
  });

  it('buffers indexed argument deltas until the provider tool call id is known', async () => {
    const deltas = await collectToolCallDeltas([
      { type: 'tool_call_part', argumentsPart: '{"command"', index: 0 },
      {
        type: 'function',
        id: 'call_bash',
        name: 'Bash',
        arguments: null,
        _streamIndex: 0,
      },
      { type: 'tool_call_part', argumentsPart: ':"pwd"}', index: 0 },
    ]);

    expect(deltas).toEqual([
      { toolCallId: 'call_bash', name: 'Bash' },
      { toolCallId: 'call_bash', name: 'Bash', argumentsPart: '{"command"' },
      { toolCallId: 'call_bash', name: 'Bash', argumentsPart: ':"pwd"}' },
    ]);
    expect(deltas.map((delta) => delta.toolCallId)).not.toContain('0');
  });

  it('uses the latest tool call identity for linear unindexed argument deltas', async () => {
    const deltas = await collectToolCallDeltas([
      {
        type: 'function',
        id: 'call_write',
        name: 'Write',
        arguments: null,
      },
      { type: 'tool_call_part', argumentsPart: '{"path"' },
      { type: 'tool_call_part', argumentsPart: ':"a.txt"}' },
    ]);

    expect(deltas).toEqual([
      { toolCallId: 'call_write', name: 'Write' },
      { toolCallId: 'call_write', name: 'Write', argumentsPart: '{"path"' },
      { toolCallId: 'call_write', name: 'Write', argumentsPart: ':"a.txt"}' },
    ]);
  });
});

describe('KosongLLM stream timing', () => {
  it('returns timing measured from provider request start to stream end', async () => {
    const generate: GenerateFn = async (
      _provider,
      _systemPrompt,
      _tools,
      _history,
      callbacks,
      options,
    ) => {
      options?.onRequestStart?.();
      await callbacks?.onMessagePart?.({ type: 'text', text: 'timed' });
      options?.onStreamEnd?.();
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'timed' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({
      provider,
      systemPrompt: 'system',
      generate,
    });

    const response = await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(response.streamTiming).toMatchObject({
      firstTokenLatencyMs: expect.any(Number),
      streamDurationMs: expect.any(Number),
    });
    expect(response.streamTiming?.firstTokenLatencyMs).toBeGreaterThanOrEqual(0);
    expect(response.streamTiming?.streamDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('splits first-token latency across the request-dispatch boundary', async () => {
    const generate: GenerateFn = async (
      _provider,
      _systemPrompt,
      _tools,
      _history,
      callbacks,
      options,
    ) => {
      options?.onRequestStart?.();
      options?.onRequestSent?.();
      await callbacks?.onMessagePart?.({ type: 'text', text: 'timed' });
      options?.onStreamEnd?.();
      return {
        id: 'response-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'timed' }], toolCalls: [] },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({ provider, systemPrompt: 'system', generate });

    const response = await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    const timing = response.streamTiming;
    expect(timing?.requestBuildMs).toBeGreaterThanOrEqual(0);
    expect(timing?.serverFirstTokenMs).toBeGreaterThanOrEqual(0);
    expect((timing?.requestBuildMs ?? 0) + (timing?.serverFirstTokenMs ?? 0)).toBe(
      timing?.firstTokenLatencyMs,
    );
  });

  it('leaves first-token split undefined when provider dispatch is not reported', async () => {
    const generate: GenerateFn = async (
      _provider,
      _systemPrompt,
      _tools,
      _history,
      callbacks,
      options,
    ) => {
      options?.onRequestStart?.();
      await callbacks?.onMessagePart?.({ type: 'text', text: 'timed' });
      options?.onStreamEnd?.();
      return {
        id: 'response-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'timed' }], toolCalls: [] },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({ provider, systemPrompt: 'system', generate });

    const response = await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(response.streamTiming?.firstTokenLatencyMs).toBeGreaterThanOrEqual(0);
    expect(response.streamTiming?.requestBuildMs).toBeUndefined();
    expect(response.streamTiming?.serverFirstTokenMs).toBeUndefined();
  });

  it('surfaces the decode wait/consume split reported by the stream', async () => {
    const generate: GenerateFn = async (
      _provider,
      _systemPrompt,
      _tools,
      _history,
      callbacks,
      options,
    ) => {
      options?.onRequestStart?.();
      options?.onRequestSent?.();
      await callbacks?.onMessagePart?.({ type: 'text', text: 'timed' });
      options?.onStreamEnd?.({ serverDecodeMs: 800, clientConsumeMs: 200 });
      return {
        id: 'response-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'timed' }], toolCalls: [] },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({ provider, systemPrompt: 'system', generate });

    const response = await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(response.streamTiming?.serverDecodeMs).toBe(800);
    expect(response.streamTiming?.clientConsumeMs).toBe(200);
  });

  it('leaves decode split undefined when the stream reports no accounting', async () => {
    const generate: GenerateFn = async (
      _provider,
      _systemPrompt,
      _tools,
      _history,
      callbacks,
      options,
    ) => {
      options?.onRequestStart?.();
      await callbacks?.onMessagePart?.({ type: 'text', text: 'timed' });
      options?.onStreamEnd?.();
      return {
        id: 'response-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'timed' }], toolCalls: [] },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({ provider, systemPrompt: 'system', generate });

    const response = await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(response.streamTiming?.serverDecodeMs).toBeUndefined();
    expect(response.streamTiming?.clientConsumeMs).toBeUndefined();
  });
});

describe('KosongLLM completion budget', () => {
  it('applies the model context window as the completion cap', async () => {
    let appliedCap: number | undefined;
    let generatedProvider: ChatProvider | undefined;
    const providerWithBudget: ChatProvider = {
      ...provider,
      withMaxCompletionTokens(n: number) {
        appliedCap = n;
        return { ...this, withMaxCompletionTokens: this.withMaxCompletionTokens };
      },
    };
    const generate: GenerateFn = async (nextProvider) => {
      generatedProvider = nextProvider;
      return {
        id: 'response-1',
        message: { role: 'assistant', content: [], toolCalls: [] },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({
      provider: providerWithBudget,
      systemPrompt: 'system',
      capability: makeCapability(10000),
      completionBudgetConfig: { fallback: 32000 },
      generate,
    });

    await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(appliedCap).toBe(10000);
    expect(generatedProvider).not.toBe(providerWithBudget);
  });
});

describe('KosongLLM provider routing', () => {
  it('snapshots candidate cooldown state without exposing API keys', () => {
    const primaryProvider = makeProvider('openai', 'gpt-primary');
    const backupProvider = makeProvider('openai', 'gpt-backup');
    const route = {
      key: 'k2',
      strategy: 'round_robin' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: primaryProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: backupProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      state.recordFailure(route, route.candidates[0]!, {
        kind: 'rate_limit',
        cooldownMs: 60_000,
      });

      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:2',
      ]);
      expect(state.snapshot(route).candidates[0]).toMatchObject({
        modelAlias: 'k2',
        providerName: 'openai',
        credentialLabel: 'api_key:1',
        providerModel: 'gpt-primary',
        lastFailureKind: 'rate_limit',
        lastFailureAt: now,
        cooldownUntil: now + 60_000,
        failureCount: 1,
      });

      vi.setSystemTime(now + 60_001);

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        modelAlias: 'k2',
        providerName: 'openai',
        credentialLabel: 'api_key:1',
        providerModel: 'gpt-primary',
        lastFailureKind: 'rate_limit',
        lastFailureAt: now,
        failureCount: 1,
      });
      expect(state.snapshot(route).candidates[0]?.cooldownUntil).toBeUndefined();
      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:1',
        'api_key:2',
      ]);

      vi.setSystemTime(now + 70_000);
      state.recordSuccess(route, route.candidates[0]!);

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        lastSuccessAt: now + 70_000,
        successCount: 1,
        failureCount: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets candidate cooldowns and health counters', () => {
    const primaryProvider = makeProvider('openai', 'gpt-primary');
    const backupProvider = makeProvider('openai', 'gpt-backup');
    const route = {
      key: 'k2',
      strategy: 'fallback' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: primaryProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: backupProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      state.recordFailure(route, route.candidates[0]!, {
        kind: 'rate_limit',
        cooldownMs: 60_000,
      });
      vi.setSystemTime(now + 1_000);
      state.recordSuccess(route, route.candidates[1]!);

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        lastFailureKind: 'rate_limit',
        failureCount: 1,
        cooldownUntil: now + 60_000,
      });
      expect(state.snapshot(route).candidates[1]).toMatchObject({
        lastSuccessAt: now + 1_000,
        successCount: 1,
      });

      expect(state.reset(route)).toBe(true);
      expect(state.snapshot(route).candidates).toEqual([
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          providerModel: 'gpt-primary',
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          providerModel: 'gpt-backup',
        },
      ]);
      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:1',
        'api_key:2',
      ]);
      expect(state.reset(route)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('orders least-used candidates by observed request count', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const thirdProvider = makeProvider('openai', 'gpt-third');
    const route = {
      key: 'k2',
      strategy: 'least_used' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:3',
          provider: thirdProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();

    state.recordSuccess(route, route.candidates[0]!);
    state.recordSuccess(route, route.candidates[0]!);
    state.recordSuccess(route, route.candidates[1]!);

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:3',
      'api_key:2',
      'api_key:1',
    ]);
  });

  it('pins session-affinity routes to the first successful candidate until it fails', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const route = {
      key: 'k2',
      strategy: 'round_robin' as const,
      sessionAffinity: true,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:1',
      'api_key:2',
    ]);

    state.recordSuccess(route, route.candidates[1]!);

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:2',
      'api_key:1',
    ]);
    expect(state.snapshot(route)).toMatchObject({
      sessionAffinity: true,
      candidates: [
        { credentialLabel: 'api_key:1' },
        { credentialLabel: 'api_key:2', pinned: true },
      ],
    });

    state.recordFailure(route, route.candidates[1]!, { kind: 'rate_limit', cooldownMs: 60_000 });

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:1',
    ]);
    expect(state.snapshot(route).candidates[1]?.pinned).toBeUndefined();
  });

  it('orders the preferred credential before other healthy candidates', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const route = {
      key: 'k2',
      strategy: 'round_robin' as const,
      preferredCredential: 'openai:api_key:2',
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:2',
      'api_key:1',
    ]);
    expect(state.snapshot(route)).toMatchObject({
      preferredCredential: 'openai:api_key:2',
      candidates: [
        { credentialLabel: 'api_key:1' },
        { credentialLabel: 'api_key:2', preferred: true },
      ],
    });

    state.recordFailure(route, route.candidates[1]!, { kind: 'rate_limit', cooldownMs: 60_000 });

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:1',
    ]);
  });

  it('routes away from credentials that exhaust local RPM or TPM windows', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const route = {
      key: 'k2',
      strategy: 'rate_limit_aware' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          localLimits: { rpm: 1, tpm: 100 },
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          localLimits: { rpm: 10, tpm: 1000 },
          provider: secondProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      state.recordSuccess(route, route.candidates[0]!, {
        usage: {
          inputOther: 40,
          inputCacheRead: 0,
          inputCacheCreation: 0,
          output: 60,
        },
      });

      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:2',
      ]);
      expect(state.unavailable(route)).toBeUndefined();
      expect(state.snapshot(route).candidates[0]).toMatchObject({
        credentialLabel: 'api_key:1',
        rateLimitHeadroom: 0,
        rateLimits: [
          { name: 'local_requests', limit: 1, remaining: 0, resetAt: now + 60_000 },
          { name: 'local_tokens', limit: 100, remaining: 0, resetAt: now + 60_000 },
        ],
      });

      state.recordSuccess(route, route.candidates[1]!, {
        usage: {
          inputOther: 1000,
          inputCacheRead: 0,
          inputCacheCreation: 0,
          output: 0,
        },
      });

      expect(state.unavailable(route)).toMatchObject({
        retryAt: now + 60_000,
        retryAfterMs: 60_000,
      });

      vi.setSystemTime(now + 60_001);

      expect(state.unavailable(route)).toBeUndefined();
      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:1',
        'api_key:2',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('orders lowest-latency candidates by observed average latency', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const thirdProvider = makeProvider('openai', 'gpt-third');
    const route = {
      key: 'k2',
      strategy: 'lowest_latency' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:3',
          provider: thirdProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();

    state.recordSuccess(route, route.candidates[0]!, { latencyMs: 300 });
    state.recordSuccess(route, route.candidates[1]!, { latencyMs: 100 });
    state.recordSuccess(route, route.candidates[0]!, { latencyMs: 100 });

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:2',
      'api_key:1',
      'api_key:3',
    ]);
    expect(state.snapshot(route).candidates).toMatchObject([
      { credentialLabel: 'api_key:1', lastLatencyMs: 100, avgLatencyMs: 260 },
      { credentialLabel: 'api_key:2', lastLatencyMs: 100, avgLatencyMs: 100 },
      { credentialLabel: 'api_key:3' },
    ]);
  });

  it('orders rate-limit-aware candidates by observed remaining headroom', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const thirdProvider = makeProvider('openai', 'gpt-third');
    const fourthProvider = makeProvider('openai', 'gpt-fourth');
    const route = {
      key: 'k2',
      strategy: 'rate_limit_aware' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:3',
          provider: thirdProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:4',
          provider: fourthProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:1',
      'api_key:2',
      'api_key:3',
      'api_key:4',
    ]);

    state.recordRateLimits(route, route.candidates[0]!, [
      { name: 'requests', limit: 100, remaining: 90 },
      { name: 'tokens', limit: 1000, remaining: 20 },
    ]);
    state.recordRateLimits(route, route.candidates[1]!, [
      { name: 'requests', limit: 100, remaining: 30 },
    ]);
    state.recordRateLimits(route, route.candidates[3]!, [
      { name: 'requests', limit: 100, remaining: 0 },
    ]);

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:2',
      'api_key:1',
      'api_key:3',
      'api_key:4',
    ]);
    expect(state.snapshot(route).candidates).toMatchObject([
      { credentialLabel: 'api_key:1', rateLimitHeadroom: 0.02 },
      { credentialLabel: 'api_key:2', rateLimitHeadroom: 0.3 },
      { credentialLabel: 'api_key:3' },
      { credentialLabel: 'api_key:4', rateLimitHeadroom: 0 },
    ]);
  });

  it('auto-rotates leading credential candidates before fallback models', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const backupProvider = makeProvider('anthropic', 'claude-backup');
    const route = {
      key: 'k2',
      strategy: 'auto' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
        {
          modelAlias: 'backup',
          providerName: 'anthropic',
          credentialLabel: 'api_key:1',
          provider: backupProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();

    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:1',
      'api_key:2',
      'api_key:1',
    ]);
    expect(state.orderCandidates(route).map((candidate) => candidate.modelAlias)).toEqual([
      'k2',
      'k2',
      'backup',
    ]);
    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:1',
      'api_key:2',
      'api_key:1',
    ]);

    expect(state.reset(route)).toBe(true);
    expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
      'api_key:1',
      'api_key:2',
      'api_key:1',
    ]);
  });

  it('auto-prefers live rate-limit headroom and ignores expired limit buckets', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const route = {
      key: 'k2',
      strategy: 'auto' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      state.recordRateLimits(route, route.candidates[0]!, [
        { name: 'requests', limit: 100, remaining: 0, resetAt: now - 1_000 },
      ]);
      state.recordRateLimits(route, route.candidates[1]!, [
        { name: 'requests', limit: 100, remaining: 20, resetAt: now + 60_000 },
      ]);

      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:2',
        'api_key:1',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps fill-first candidates in config order while skipping cooling candidates', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const route = {
      key: 'k2',
      strategy: 'fill_first' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:1',
        'api_key:2',
      ]);

      state.recordFailure(route, route.candidates[0]!, {
        kind: 'rate_limit',
        cooldownMs: 60_000,
      });

      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:2',
      ]);

      vi.setSystemTime(now + 60_001);

      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:1',
        'api_key:2',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('randomizes candidate order when the route strategy is random', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const thirdProvider = makeProvider('openai', 'gpt-third');
    const route = {
      key: 'k2',
      strategy: 'random' as const,
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          provider: firstProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          provider: secondProvider,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:3',
          provider: thirdProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      expect(state.orderCandidates(route).map((candidate) => candidate.credentialLabel)).toEqual([
        'api_key:2',
        'api_key:3',
        'api_key:1',
      ]);
      expect(random).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
  });

  it('orders weighted round-robin candidates by configured weights', () => {
    const firstProvider = makeProvider('openai', 'gpt-first');
    const secondProvider = makeProvider('openai', 'gpt-second');
    const route = {
      key: 'k2',
      strategy: 'weighted_round_robin' as const,
      candidates: [
        {
          modelAlias: 'primary',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          weight: 3,
          provider: firstProvider,
        },
        {
          modelAlias: 'backup',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          weight: 1,
          provider: secondProvider,
        },
      ],
    };
    const state = new InMemoryProviderRouteState();

    expect(state.orderCandidates(route)[0]?.modelAlias).toBe('primary');
    expect(state.orderCandidates(route)[0]?.modelAlias).toBe('primary');
    expect(state.orderCandidates(route)[0]?.modelAlias).toBe('backup');
    expect(state.orderCandidates(route)[0]?.modelAlias).toBe('primary');

    expect(state.snapshot(route).candidates).toMatchObject([
      { modelAlias: 'primary', weight: 3 },
      { modelAlias: 'backup', weight: 1 },
    ]);
  });

  it('falls back to the next candidate on a pre-stream rate limit', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = {
      ...makeProvider('backup', 'backup-model'),
      baseUrl: 'https://backup.example/v1',
    } as ChatProvider;
    const attempts: {
      providerModel: string;
      runtimeModelAlias?: string;
      runtimeCredentialLabel?: string;
    }[] = [];
    const generate: GenerateFn = async (
      nextProvider,
      _systemPrompt,
      _tools,
      _history,
      _callbacks,
      options,
    ) => {
      attempts.push({
        providerModel: nextProvider.modelName,
        runtimeModelAlias: (options as GenerateOptionsWithRequestLogFields | undefined)
          ?.runtimeModelAlias,
        runtimeCredentialLabel: (options as GenerateOptionsWithRequestLogFields | undefined)
          ?.runtimeCredentialLabel,
      });
      if (nextProvider.modelName === 'primary-model') {
        throw new APIProviderRateLimitError('rate limited', 'req-429');
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'backup response' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({
      provider: primaryProvider,
      systemPrompt: 'system',
      generate,
      route: {
        key: 'primary',
        strategy: 'fallback',
        candidates: [
          { modelAlias: 'primary', providerName: 'primary', provider: primaryProvider },
          {
            modelAlias: 'backup',
            providerName: 'backup',
            credentialLabel: 'api_key:2',
            provider: backupProvider,
          },
        ],
      },
      routeState: new InMemoryProviderRouteState(),
    });

    const response = await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(attempts).toEqual([
      {
        providerModel: 'primary-model',
        runtimeModelAlias: 'primary',
        runtimeCredentialLabel: undefined,
      },
      {
        providerModel: 'backup-model',
        runtimeModelAlias: 'backup',
        runtimeCredentialLabel: 'api_key:2',
      },
    ]);
    expect(response.usageModel).toBe('backup');
    expect(response.providerRouteSelection).toEqual({
      modelAlias: 'backup',
      providerName: 'backup',
      credentialLabel: 'api_key:2',
      providerModel: 'backup-model',
      baseUrl: 'https://backup.example/v1',
    });
  });

  it('notifies route status changes when a candidate enters cooldown', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const onRouteStatusChanged = vi.fn();
    const generate: GenerateFn = async (nextProvider) => {
      if (nextProvider.modelName === 'primary-model') {
        throw new APIProviderRateLimitError('rate limited', 'req-429');
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'backup response' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const llm = new KosongLLM({
      provider: primaryProvider,
      systemPrompt: 'system',
      generate,
      route: {
        key: 'primary',
        strategy: 'fallback',
        candidates: [
          { modelAlias: 'primary', providerName: 'primary', provider: primaryProvider },
          { modelAlias: 'backup', providerName: 'backup', provider: backupProvider },
        ],
      },
      routeState: new InMemoryProviderRouteState(),
      onRouteStatusChanged,
    });

    await llm.chat({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    });

    expect(onRouteStatusChanged).toHaveBeenCalledTimes(2);
  });

  it('uses provider retry-after headers for route cooldowns', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate: GenerateFn = async (nextProvider) => {
      if (nextProvider.modelName === 'primary-model') {
        throw Object.assign(new Error('rate limited'), {
          statusCode: 429,
          headers: { 'retry-after': '7' },
        });
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'backup response' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      await llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      });

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        lastFailureKind: 'rate_limit',
        cooldownUntil: now + 7_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses exhausted OpenAI rate-limit reset headers when retry-after is absent', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate: GenerateFn = async (nextProvider) => {
      if (nextProvider.modelName === 'primary-model') {
        throw Object.assign(new Error('rate limited'), {
          statusCode: 429,
          headers: {
            'x-ratelimit-remaining-requests': '0',
            'x-ratelimit-reset-requests': '1s',
            'x-ratelimit-remaining-tokens': '0',
            'x-ratelimit-reset-tokens': '6m0s',
          },
        });
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'backup response' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      await llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      });

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        lastFailureKind: 'rate_limit',
        cooldownUntil: now + 6 * 60_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses exhausted Anthropic rate-limit reset headers when retry-after is absent', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate: GenerateFn = async (nextProvider) => {
      if (nextProvider.modelName === 'primary-model') {
        throw Object.assign(new Error('rate limited'), {
          statusCode: 429,
          headers: {
            'anthropic-ratelimit-tokens-remaining': '0',
            'anthropic-ratelimit-tokens-reset': new Date(now + 45_000).toISOString(),
          },
        });
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'backup response' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      await llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      });

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        lastFailureKind: 'rate_limit',
        cooldownUntil: now + 45_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('proactively cools down a successful candidate when response headers show exhausted quota', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate: GenerateFn = async (nextProvider) => ({
      id: 'response-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `${nextProvider.modelName} response` }],
        toolCalls: [],
      },
      usage: emptyUsage(),
      finishReason: 'completed',
      rawFinishReason: 'stop',
      responseHeaders:
        nextProvider.modelName === 'primary-model'
          ? {
              'x-ratelimit-limit-requests': '100',
              'x-ratelimit-remaining-requests': '0',
              'x-ratelimit-reset-requests': '30s',
            }
          : undefined,
    });
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      const response = await llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      });

      expect(response.usageModel).toBe('primary');
      expect(state.snapshot(route).candidates[0]).toMatchObject({
        modelAlias: 'primary',
        rateLimits: [
          {
            name: 'requests',
            limit: 100,
            remaining: 0,
            resetAt: now + 30_000,
          },
        ],
        cooldownUntil: now + 30_000,
        cooldownKind: 'rate_limit',
        successCount: 1,
      });
      expect(state.snapshot(route).candidates[0]?.failureCount).toBeUndefined();
      expect(state.snapshot(route).candidates[0]?.lastFailureKind).toBeUndefined();
      expect(state.orderCandidates(route).map((candidate) => candidate.modelAlias)).toEqual([
        'backup',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('proactively cools down exhausted response headers even without reset headers', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate: GenerateFn = async (nextProvider) => ({
      id: 'response-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `${nextProvider.modelName} response` }],
        toolCalls: [],
      },
      usage: emptyUsage(),
      finishReason: 'completed',
      rawFinishReason: 'stop',
      responseHeaders:
        nextProvider.modelName === 'primary-model'
          ? {
              'x-ratelimit-limit-requests': '100',
              'x-ratelimit-remaining-requests': '0',
            }
          : undefined,
    });
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      const response = await llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      });

      expect(response.usageModel).toBe('primary');
      expect(state.snapshot(route).candidates[0]).toMatchObject({
        modelAlias: 'primary',
        rateLimits: [
          {
            name: 'requests',
            limit: 100,
            remaining: 0,
          },
        ],
        cooldownUntil: now + 60_000,
        cooldownKind: 'rate_limit',
        successCount: 1,
      });
      expect(state.orderCandidates(route).map((candidate) => candidate.modelAlias)).toEqual([
        'backup',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies insufficient quota 429s as quota exhaustion', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate: GenerateFn = async (nextProvider) => {
      if (nextProvider.modelName === 'primary-model') {
        throw Object.assign(new Error('provider request failed'), {
          statusCode: 429,
          response: {
            data: {
              error: {
                type: 'insufficient_quota',
                code: 'insufficient_quota',
              },
            },
          },
        });
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'backup response' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      await llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      });

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        lastFailureKind: 'quota',
        cooldownUntil: now + 60 * 60_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies exhausted credit errors as quota exhaustion', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate: GenerateFn = async (nextProvider) => {
      if (nextProvider.modelName === 'primary-model') {
        throw Object.assign(new Error('No credits remaining for this API key'), {
          statusCode: 429,
        });
      }
      return {
        id: 'response-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'backup response' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed',
        rawFinishReason: 'stop',
      };
    };
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      await llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      });

      expect(state.snapshot(route).candidates[0]).toMatchObject({
        lastFailureKind: 'quota',
        cooldownUntil: now + 60 * 60_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails fast when all route candidates are cooling down', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate = vi.fn<GenerateFn>();
    const route = {
      key: 'primary',
      strategy: 'fallback' as const,
      candidates: [
        { modelAlias: 'primary', providerName: 'primary', provider: primaryProvider },
        { modelAlias: 'backup', providerName: 'backup', provider: backupProvider },
      ],
    };
    state.recordFailure(route, route.candidates[0]!, { kind: 'rate_limit', cooldownMs: 5_000 });
    state.recordFailure(route, route.candidates[1]!, { kind: 'quota', cooldownMs: 10_000 });
    const llm = new KosongLLM({
      provider: primaryProvider,
      systemPrompt: 'system',
      generate,
      route,
      routeState: state,
    });

    try {
      await expect(
        llm.chat({
          messages: [],
          tools: [],
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PROVIDER_RATE_LIMIT,
        details: {
          route: 'primary',
          retryAfterMs: 5_000,
          retryAt: now + 5_000,
        },
      });
      expect(generate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records the last candidate failure before surfacing the provider error', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const state = new InMemoryProviderRouteState();
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const generate = vi.fn<GenerateFn>(async () => {
      throw new APIProviderRateLimitError('rate limited', 'req-429');
    });
    const route = {
      key: 'primary',
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
      routeState: state,
    });

    try {
      await expect(
        llm.chat({
          messages: [],
          tools: [],
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('rate limited');

      expect(generate).toHaveBeenCalledTimes(2);
      expect(state.snapshot(route).candidates).toMatchObject([
        {
          modelAlias: 'primary',
          lastFailureKind: 'rate_limit',
          cooldownUntil: now + 60_000,
        },
        {
          modelAlias: 'backup',
          lastFailureKind: 'rate_limit',
          cooldownUntil: now + 60_000,
        },
      ]);

      generate.mockClear();

      await expect(
        llm.chat({
          messages: [],
          tools: [],
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        code: ErrorCodes.PROVIDER_RATE_LIMIT,
        details: {
          route: 'primary',
          retryAfterMs: 60_000,
          retryAt: now + 60_000,
        },
      });
      expect(generate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fall back after stream output has started', async () => {
    const primaryProvider = makeProvider('primary', 'primary-model');
    const backupProvider = makeProvider('backup', 'backup-model');
    const attempts: string[] = [];
    const deltas: string[] = [];
    const generate: GenerateFn = async (nextProvider, _systemPrompt, _tools, _history, callbacks) => {
      attempts.push(nextProvider.modelName);
      await callbacks?.onMessagePart?.({ type: 'text', text: 'partial' });
      throw new APIProviderRateLimitError('rate limited after partial output', 'req-429');
    };
    const llm = new KosongLLM({
      provider: primaryProvider,
      systemPrompt: 'system',
      generate,
      route: {
        key: 'primary',
        strategy: 'fallback',
        candidates: [
          { modelAlias: 'primary', providerName: 'primary', provider: primaryProvider },
          { modelAlias: 'backup', providerName: 'backup', provider: backupProvider },
        ],
      },
      routeState: new InMemoryProviderRouteState(),
    });

    await expect(
      llm.chat({
        messages: [],
        tools: [],
        signal: new AbortController().signal,
        onTextDelta: (delta) => deltas.push(delta),
      }),
    ).rejects.toThrow('rate limited after partial output');

    expect(attempts).toEqual(['primary-model']);
    expect(deltas).toEqual(['partial']);
  });
});

async function collectToolCallDeltas(
  parts: readonly StreamedMessagePart[],
): Promise<ToolCallDelta[]> {
  const deltas: ToolCallDelta[] = [];
  const generate: GenerateFn = async (_provider, _systemPrompt, _tools, _history, callbacks) => {
    for (const part of parts) {
      await callbacks?.onMessagePart?.(part);
    }
    return {
      id: 'response-1',
      message: {
        role: 'assistant',
        content: [],
        toolCalls: parts
          .filter((part): part is ToolCall => isToolCall(part))
          .map((toolCall) => stripStreamIndex(toolCall)),
      },
      usage: emptyUsage(),
      finishReason: 'tool_calls',
      rawFinishReason: 'tool_calls',
    };
  };
  const llm = new KosongLLM({
    provider,
    systemPrompt: 'system',
    generate,
  });

  await llm.chat({
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    onToolCallDelta: (delta) => deltas.push(delta),
  });

  return deltas;
}

function isToolCall(part: StreamedMessagePart): part is ToolCall {
  return part.type === 'function';
}

function stripStreamIndex(toolCall: ToolCall): ToolCall {
  const { _streamIndex: _, ...rest } = toolCall;
  return rest;
}

function makeProvider(name: string, modelName: string): ChatProvider {
  return {
    ...provider,
    name,
    modelName,
  };
}

function makeCapability(maxContextTokens: number): ModelCapability {
  return {
    image_in: false,
    video_in: false,
    audio_in: false,
    thinking: false,
    tool_use: true,
    max_context_tokens: maxContextTokens,
  };
}
