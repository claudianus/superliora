import { APIStatusError, type ChatProvider } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import {
  runSideGenerateWithSharedFailover,
  sideCandidateKey,
} from '../../src/agent/side-generate-failover';
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

  it('sideCandidateKey is stable for matching attempts to ordered candidates', () => {
    const a = candidate('oauth:0');
    const b = candidate('oauth:0');
    expect(sideCandidateKey(a)).toBe(sideCandidateKey(b));
    expect(sideCandidateKey(candidate('oauth:1'))).not.toBe(sideCandidateKey(a));
  });
});
