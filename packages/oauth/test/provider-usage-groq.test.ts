import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchGroqUsage, parseGroqRateLimitHeaders } from '../src/provider-usage/provider-usage-fetch-groq';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseGroqRateLimitHeaders', () => {
  it('labels remaining-requests as requests/day, not RPM', () => {
    const res = new Response('{}', {
      status: 200,
      headers: {
        'x-ratelimit-limit-requests': '14400',
        'x-ratelimit-remaining-requests': '12000',
        'x-ratelimit-reset-requests': '2h',
      },
    });
    const rows = parseGroqRateLimitHeaders(res);
    expect(rows[0]).toMatchObject({ label: 'Requests/day', used: 2400, limit: 14400 });
  });
});

describe('fetchGroqUsage', () => {
  it('reads GET /openai/v1/models headers', async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: {
            'x-ratelimit-limit-requests': '100',
            'x-ratelimit-remaining-requests': '40',
          },
        }),
    );
    vi.stubGlobal('fetch', spy);
    const snapshot = await fetchGroqUsage('groq', 'gsk-test');
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect(snapshot.summary).toMatchObject({ label: 'Requests/day', used: 60, limit: 100 });
  });
});
