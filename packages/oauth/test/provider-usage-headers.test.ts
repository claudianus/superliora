import { describe, expect, it } from 'vitest';

import { parseRateLimitHeaders } from '../src/provider-usage/provider-usage-headers';

describe('parseRateLimitHeaders', () => {
  it('parses OpenAI-style remaining/limit/reset headers', () => {
    const rows = parseRateLimitHeaders({
      'x-ratelimit-limit-requests': '60',
      'x-ratelimit-remaining-requests': '45',
      'x-ratelimit-reset-requests': '6m0s',
      'x-ratelimit-limit-tokens': '80000',
      'x-ratelimit-remaining-tokens': '20000',
    });
    expect(rows[0]).toMatchObject({ label: 'Requests', used: 15, limit: 60 });
    expect(rows[1]).toMatchObject({ label: 'Tokens', used: 60000, limit: 80000 });
    expect(rows[0]!.resetHint).toContain('resets');
  });

  it('parses Anthropic remaining/limit headers', () => {
    const rows = parseRateLimitHeaders({
      'anthropic-ratelimit-requests-limit': '50',
      'anthropic-ratelimit-requests-remaining': '10',
      'anthropic-ratelimit-requests-reset': '2099-01-01T00:00:00Z',
      'anthropic-ratelimit-tokens-remaining': '1000',
      'anthropic-ratelimit-tokens-limit': '4000',
    });
    expect(rows[0]).toMatchObject({ label: 'Requests', used: 40, limit: 50 });
    expect(rows[1]).toMatchObject({ label: 'Tokens', used: 3000, limit: 4000 });
  });

  it('returns empty when remaining is absent — never invents 100%', () => {
    expect(parseRateLimitHeaders({ 'x-ratelimit-limit-requests': '60' })).toEqual([]);
  });

  it('surfaces retry-after when no remaining headers exist', () => {
    const rows = parseRateLimitHeaders({ 'retry-after': '30' });
    expect(rows[0]?.label).toBe('Retry-After');
    expect(rows[0]?.resetHint).toBeDefined();
  });
});
