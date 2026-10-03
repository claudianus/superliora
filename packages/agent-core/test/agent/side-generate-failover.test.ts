import { APIStatusError, APITimeoutError, type ChatProvider } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import { runSideGenerateWithSharedFailover } from '../../src/agent/side-generate-failover';
import {
  InMemoryProviderRouteState,
  type KosongLLMRoute,
  type KosongLLMRouteCandidate,
} from '../../src/agent/turn/kosong-llm';

function fakeProvider(modelName: string): ChatProvider {
  return {
    name: 'fake',
    modelName,
    generate: async () => {
      throw new Error('unused');
    },
  } as unknown as ChatProvider;
}

function candidate(label: string, modelAlias = 'model-a'): KosongLLMRouteCandidate {
  return {
    modelAlias,
    provider: fakeProvider(modelAlias),
    providerName: 'fake',
    credentialLabel: label,
  };
}

function routeOf(...labels: string[]): KosongLLMRoute {
  return {
    key: 'fake::model-a',
    strategy: 'fallback',
    candidates: labels.map((label) => candidate(label)),
  };
}

/** Message-pattern quota error (matches PROVIDER_QUOTA_MESSAGE_PATTERNS). */
function quotaMessageError(): Error {
  return new Error('insufficient quota: monthly spend limit reached');
}

function statusQuotaError(): APIStatusError {
  return new APIStatusError(402, 'payment required');
}

describe('runSideGenerateWithSharedFailover', () => {
  it('fails over from exhausted primary credential to secondary success', async () => {
    const route = routeOf('oauth:0', 'oauth:1');
    const state = new InMemoryProviderRouteState();
    const calls: string[] = [];

    const result = await runSideGenerateWithSharedFailover({
      route,
      routeState: state,
      attempts: route.candidates.map((c) => ({
        candidate: c,
        run: async () => {
          calls.push(c.credentialLabel ?? '');
          if (c.credentialLabel === 'oauth:0') {
            throw quotaMessageError();
          }
          return { ok: true, credential: c.credentialLabel };
        },
      })),
    });

    expect(calls).toEqual(['oauth:0', 'oauth:1']);
    expect(result).toEqual({ ok: true, credential: 'oauth:1' });
    // Primary cooled down; secondary first on next order.
    expect(state.orderCandidates(route).map((c) => c.credentialLabel)[0]).toBe('oauth:1');
  });

  it('classifies HTTP 402 as failover-class and tries the next candidate', async () => {
    const route = routeOf('api:0', 'api:1');
    const state = new InMemoryProviderRouteState();
    const result = await runSideGenerateWithSharedFailover({
      route,
      routeState: state,
      attempts: [
        {
          candidate: route.candidates[0]!,
          run: async () => {
            throw statusQuotaError();
          },
        },
        {
          candidate: route.candidates[1]!,
          run: async () => 'secondary-ok',
        },
      ],
    });
    expect(result).toBe('secondary-ok');
  });

  it('fails over a custom OpenAI-compatible abort to the next credential', async () => {
    const route = routeOf('oauth:0', 'oauth:1');
    const state = new InMemoryProviderRouteState();
    const calls: string[] = [];

    const result = await runSideGenerateWithSharedFailover({
      route,
      routeState: state,
      attempts: route.candidates.map((c) => ({
        candidate: c,
        run: async () => {
          calls.push(c.credentialLabel ?? '');
          if (c.credentialLabel === 'oauth:0') {
            throw new APITimeoutError('Request was aborted.');
          }
          return { ok: true, credential: c.credentialLabel };
        },
      })),
    });

    expect(calls).toEqual(['oauth:0', 'oauth:1']);
    expect(result).toEqual({ ok: true, credential: 'oauth:1' });
  });

  it('rethrows non-failover errors without trying the next candidate', async () => {
    const route = routeOf('oauth:0', 'oauth:1');
    const state = new InMemoryProviderRouteState();
    const second = vi.fn(async () => 'should-not-run');

    await expect(
      runSideGenerateWithSharedFailover({
        route,
        routeState: state,
        attempts: [
          {
            candidate: route.candidates[0]!,
            run: async () => {
              throw new Error('bad request shape');
            },
          },
          {
            candidate: route.candidates[1]!,
            run: second,
          },
        ],
      }),
    ).rejects.toThrow(/bad request shape/);

    expect(second).not.toHaveBeenCalled();
  });

  it('fails fast without network attempts when every candidate is cooling down', async () => {
    const route = routeOf('oauth:0', 'oauth:1');
    const state = new InMemoryProviderRouteState();
    for (const c of route.candidates) {
      state.recordFailure(route, c, { kind: 'quota', cooldownMs: 60_000 });
    }
    const run = vi.fn(async () => 'should-not-run');
    const failed = vi.fn();

    await expect(
      runSideGenerateWithSharedFailover({
        route,
        routeState: state,
        attempts: route.candidates.map((c) => ({ candidate: c, run })),
        onCandidateFailed: failed,
      }),
    ).rejects.toMatchObject({
      name: 'LioraError',
      details: expect.objectContaining({
        routeUnavailable: true,
        dominantFailureKind: 'quota',
      }),
    });

    expect(run).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it('surfaces the final provider failure after exhausting credentials without synthesizing a response', async () => {
    const route = routeOf('oauth:0', 'oauth:1');
    const state = new InMemoryProviderRouteState();
    const first = new APIStatusError(401, 'Unauthorized');
    const last = new APIStatusError(402, 'Payment required');
    const attempts = route.candidates.map((candidate, index) => ({
      candidate,
      run: vi.fn(async () => { throw index === 0 ? first : last; }),
    }));

    await expect(runSideGenerateWithSharedFailover({
      route,
      routeState: state,
      attempts,
    })).rejects.toBe(last);
    expect(attempts[0]!.run).toHaveBeenCalledTimes(1);
    expect(attempts[1]!.run).toHaveBeenCalledTimes(1);
    expect(state.snapshot(route).candidates.map((candidate) => candidate.lastFailureKind)).toEqual([
      'auth', 'quota',
    ]);
  });

  it('honors caller cancellation before cooldown classification or provider requests', async () => {
    const route = routeOf('oauth:0', 'oauth:1');
    const state = new InMemoryProviderRouteState();
    for (const candidate of route.candidates) {
      state.recordFailure(route, candidate, { kind: 'quota', cooldownMs: 60_000 });
    }
    const controller = new AbortController();
    const cancellation = new Error('cancelled by operator');
    controller.abort(cancellation);
    const run = vi.fn(async () => 'should-not-run');

    await expect(runSideGenerateWithSharedFailover({
      route,
      routeState: state,
      attempts: route.candidates.map((candidate) => ({ candidate, run })),
      signal: controller.signal,
    })).rejects.toBe(cancellation);
    expect(run).not.toHaveBeenCalled();
    expect(state.snapshot(route).candidates.every((candidate) => candidate.failureCount === 1)).toBe(true);
  });

  it('does not mark a credential or attempt a fallback when cancellation settles an active request', async () => {
    const route = routeOf('oauth:0', 'oauth:1');
    const state = new InMemoryProviderRouteState();
    const controller = new AbortController();
    const cancellation = new APITimeoutError('Request was aborted.');
    const backup = vi.fn(async () => 'should-not-run');

    await expect(runSideGenerateWithSharedFailover({
      route,
      routeState: state,
      signal: controller.signal,
      attempts: [
        {
          candidate: route.candidates[0]!,
          run: async () => {
            controller.abort();
            throw cancellation;
          },
        },
        { candidate: route.candidates[1]!, run: backup },
      ],
    })).rejects.toBe(cancellation);
    expect(backup).not.toHaveBeenCalled();
    expect(state.snapshot(route).candidates.every((candidate) => candidate.lastFailureKind === undefined)).toBe(true);
  });
});
