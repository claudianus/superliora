/**
 * ResearchSearchEngine ↔ Agent.circuitBreakerRegistry wiring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircuitBreakerRegistry } from '../../../src/runtime/circuit-breaker';
import {
  ResearchSearchEngine,
  searchChannelScopeId,
} from '../../../src/tools/providers/research-search';

describe('searchChannelScopeId', () => {
  it('maps preferred Never-Halt scope ids', () => {
    expect(searchChannelScopeId('serper')).toBe('search:google');
    expect(searchChannelScopeId('duckduckgo')).toBe('search:free');
    expect(searchChannelScopeId('searxng')).toBe('search:free');
    expect(searchChannelScopeId('browser')).toBe('search:browser');
    expect(searchChannelScopeId('chrome-ext')).toBe('search:chrome-ext');
    expect(searchChannelScopeId('brave')).toBe('search:brave');
  });
});

describe('ResearchSearchEngine circuit breakers', () => {
  beforeEach(() => {
    process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK = '1';
  });

  afterEach(() => {
    delete process.env.SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK;
  });
  it('records paid provider hard fail (429 cooldown) on injected registry', async () => {
    let now = 1_000;
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 60_000,
      now: () => now,
    });
    const onChanged = vi.fn();

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      now: () => now,
      circuitBreakers: registry,
      onCircuitBreakerChanged: onChanged,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        cooldownMs: 60_000,
        providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
      },
    });

    await engine.search('query', { limit: 1 });

    const snap = registry.get('search:brave').snapshot();
    expect(snap.failures).toBe(1);
    expect(snap.state).toBe('open');
    expect(snap.lastTripReason).toContain('429');
    expect(onChanged).toHaveBeenCalledOnce();
    expect(engine.status().providers.find((p) => p.kind === 'brave')?.ready).toBe(false);
  });

  it('records success after a paid provider returns hits', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    registry.get('search:tavily').recordFailure('prior fail');

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ title: 'Hit', url: 'https://example.com/h', content: 'snippet' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      circuitBreakers: registry,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'tavily', apiKey: 'tvly-test' }],
      },
    });

    const results = await engine.search('messi', { limit: 1 });
    expect(results).toHaveLength(1);
    expect(registry.get('search:tavily').snapshot()).toMatchObject({
      failures: 0,
      state: 'closed',
    });
  });

  it('does not trip breaker for free fallback soft-empty results', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html><body></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const engine = new ResearchSearchEngine({
      fetchImpl,
      circuitBreakers: registry,
      search: { strategy: 'auto', freeFallback: true },
      local: {
        searchUrl: 'https://duckduckgo.com/html/',
        directSources: { github: false, arxiv: false, npm: false, pypi: false, crates: false },
      },
    });

    await engine.search('empty query', { limit: 2 });
    expect(registry.snapshot().counts.total).toBe(0);
  });

  it('supports late attachCircuitBreakers binding', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    const onChanged = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'));

    const engine = new ResearchSearchEngine({
      fetchImpl,
      search: {
        strategy: 'fallback',
        freeFallback: false,
        providers: [{ kind: 'serper', apiKey: 'serper-key' }],
      },
    });

    engine.attachCircuitBreakers(registry, onChanged);
    await engine.search('q', { limit: 1 });

    expect(registry.get('search:google').snapshot()).toMatchObject({
      failures: 1,
      state: 'open',
      lastTripReason: 'network down',
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
