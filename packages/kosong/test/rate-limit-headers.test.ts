import { describe, expect, it } from 'vitest';

import { parseResponseRateLimits } from '../src/rate-limit-headers';

describe('parseResponseRateLimits', () => {
  it('maps openai-style and anthropic-style headers', () => {
    expect(
      parseResponseRateLimits({
        'x-ratelimit-limit-requests': '60',
        'x-ratelimit-remaining-requests': '45',
        'x-ratelimit-reset-requests': '6',
        'anthropic-ratelimit-tokens-limit': '4000',
        'anthropic-ratelimit-tokens-remaining': '1000',
      }),
    ).toEqual([
      expect.objectContaining({ name: 'requests', limit: 60, remaining: 45 }),
      expect.objectContaining({ name: 'tokens', limit: 4000, remaining: 1000 }),
    ]);
  });

  it('does not invent remaining when only a limit header is present', () => {
    expect(parseResponseRateLimits({ 'x-ratelimit-limit-requests': '60' })).toEqual([
      { name: 'requests', limit: 60 },
    ]);
  });
});
