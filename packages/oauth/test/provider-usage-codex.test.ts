import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearProviderUsageCache } from '../src/provider-usage/provider-usage-cache';
import {
  fetchOpenAiCodexUsage,
  parseOpenAiCodexWhamUsage,
} from '../src/provider-usage/provider-usage-fetch-codex';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearProviderUsageCache();
});

const HOUR_SECONDS = 3600;

function windowFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    used_percent: 50,
    ...overrides,
  };
}

describe('parseOpenAiCodexWhamUsage', () => {
  it('classifies a 5-hour primary as a burst and reports the weekly secondary', () => {
    // #1791-class payload: K12/Plus plans send a sub-day primary plus a real
    // 7-day secondary. Folding the primary into the weekly reading would
    // report the wrong bar.
    const parsed = parseOpenAiCodexWhamUsage({
      plan_type: 'plus',
      rate_limit: {
        primary_window: windowFixture({ used_percent: 61, limit_window_seconds: 5 * HOUR_SECONDS }),
        secondary_window: windowFixture({ used_percent: 42, limit_window_seconds: 7 * 24 * HOUR_SECONDS }),
        tertiary_window: null,
      },
    });
    expect(parsed.plan).toBe('plus');
    expect(parsed.rows.map((row) => row.label)).toEqual(['Weekly limit', '5-hour limit']);
    expect(parsed.rows[0]).toMatchObject({ used: 42, limit: 100 });
    expect(parsed.rows[1]).toMatchObject({ used: 61, limit: 100 });
  });

  it('treats an explicitly monthly primary as the monthly window even on non-go plans', () => {
    const parsed = parseOpenAiCodexWhamUsage({
      plan_type: 'team',
      rate_limit: {
        primary_window: windowFixture({ used_percent: 88, limit_window_seconds: 30 * 24 * HOUR_SECONDS }),
        secondary_window: null,
        tertiary_window: null,
      },
    });
    expect(parsed.rows.map((row) => row.label)).toEqual(['Monthly limit']);
    expect(parsed.rows[0]).toMatchObject({ used: 88 });
  });

  it('keeps Go/Free plans on the 30-day window even when duration is absent', () => {
    const parsed = parseOpenAiCodexWhamUsage({
      plan_type: 'go',
      rate_limit: {
        primary_window: windowFixture({ used_percent: 73 }),
        secondary_window: null,
        tertiary_window: null,
      },
    });
    expect(parsed.rows.map((row) => row.label)).toEqual(['30-day limit']);
    expect(parsed.rows[0]).toMatchObject({ used: 73 });
  });

  it('uses tertiary as the supplementary monthly window on weekly plans', () => {
    const parsed = parseOpenAiCodexWhamUsage({
      plan_type: 'plus',
      rate_limit: {
        primary_window: windowFixture({ used_percent: 20, limit_window_seconds: 7 * 24 * HOUR_SECONDS }),
        secondary_window: null,
        tertiary_window: windowFixture({ used_percent: 55, limit_window_seconds: 30 * 24 * HOUR_SECONDS }),
      },
    });
    expect(parsed.rows.map((row) => row.label)).toEqual(['Weekly limit', 'Monthly limit']);
    expect(parsed.rows[1]).toMatchObject({ used: 55 });
  });

  it('parses legacy flat payloads with usedPercent and percent_left aliases', () => {
    const parsed = parseOpenAiCodexWhamUsage({
      five_hour: { usedPercent: 12 },
      weekly: { percent_left: 30 },
    });
    // 100 − 30 → 70 used on the weekly window.
    expect(parsed.rows.map((row) => row.label)).toEqual(['Weekly limit', '5-hour limit']);
    expect(parsed.rows[0]).toMatchObject({ used: 70 });
    expect(parsed.rows[1]).toMatchObject({ used: 12 });
  });

  it('normalizes out-of-range percentages and converts epoch-s resets', () => {
    const parsed = parseOpenAiCodexWhamUsage({
      rate_limit: {
        primary_window: {
          used_percent: 145,
          reset_at: Math.floor(Date.now() / 1000) + 7200,
          limit_window_seconds: 7 * 24 * HOUR_SECONDS,
        },
      },
    });
    expect(parsed.rows[0]).toMatchObject({ used: 100, limit: 100 });
    expect(parsed.rows[0]!.resetHint).toMatch(/resets in 2h/);
  });

  it('treats epoch-ms resets as ms', () => {
    const parsed = parseOpenAiCodexWhamUsage({
      rate_limit: {
        primary_window: {
          used_percent: 5,
          reset_at: Date.now() + 3 * 3600_000,
          limit_window_seconds: 7 * 24 * HOUR_SECONDS,
        },
      },
    });
    expect(parsed.rows[0]!.resetHint).toMatch(/resets in 3h/);
  });

  it('captures the account email for pool display', () => {
    const parsed = parseOpenAiCodexWhamUsage({
      email: 'jane@example.com',
      plan_type: 'pro',
      rate_limit: {
        primary_window: windowFixture({ used_percent: 10, limit_window_seconds: 7 * 24 * HOUR_SECONDS }),
      },
    });
    expect(parsed.accountEmail).toBe('jane@example.com');
    expect(parsed.plan).toBe('pro');
  });

  it('never invents usage from windows without a percent', () => {
    expect(
      parseOpenAiCodexWhamUsage({
        rate_limit: {
          primary_window: { reset_at: Date.now() / 1000 },
          secondary_window: null,
          tertiary_window: null,
        },
      }).rows,
    ).toEqual([]);
    expect(parseOpenAiCodexWhamUsage(null)).toEqual({ rows: [] });
  });
});

describe('fetchOpenAiCodexUsage', () => {
  it('fetches wham/usage with ChatGPT origin headers and parses windows', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({
      plan_type: 'plus',
      email: 'jane@example.com',
      rate_limit: {
        primary_window: { used_percent: 61, reset_at: Math.floor(Date.now() / 1000) + 5 * HOUR_SECONDS, limit_window_seconds: 5 * HOUR_SECONDS },
        secondary_window: { used_percent: 42, reset_at: Math.floor(Date.now() / 1000) + 5 * 24 * HOUR_SECONDS, limit_window_seconds: 7 * 24 * HOUR_SECONDS },
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchOpenAiCodexUsage('openai-codex', 'oauth-token');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect((init.headers as Record<string, string>)['Origin']).toBe('https://chatgpt.com');
    expect(snapshot.summary).toMatchObject({ label: 'Weekly limit', used: 42, limit: 100 });
    expect(snapshot.limits).toHaveLength(1);
    expect(snapshot.limits[0]).toMatchObject({ label: '5-hour limit', used: 61 });
    expect(snapshot.plan).toBe('plus');
    expect(snapshot.accountLabel).toBe('jane@example.com');
    expect(snapshot.source).toBe('oauth-api');
    expect(snapshot.kind).toBe('subscription');
  });

  it('fails open with an auth hint on 401', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    const snapshot = await fetchOpenAiCodexUsage('openai-codex', 'expired-token');
    expect(snapshot.available).toBe(true);
    expect(snapshot.error).toContain('Token expired');
  });

  it('reports request timeouts without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }),
    );
    const snapshot = await fetchOpenAiCodexUsage('openai-codex', 'token', undefined, { timeoutMs: 1 });
    expect(snapshot.available).toBe(true);
    expect(snapshot.error).toBe('Request timed out.');
  });
});
