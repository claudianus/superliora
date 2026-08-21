import { describe, expect, it } from 'vitest';

import { parseDeepSeekBalancePayload } from '../src/provider-usage/provider-usage-fetch-deepseek';

describe('parseDeepSeekBalancePayload', () => {
  it('maps total_balance strings to remaining credits', () => {
    const parsed = parseDeepSeekBalancePayload({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '10.50' }],
    });
    expect(parsed.remainingDisplay).toBe('DS $10.50');
    expect(parsed.rows[0]).toMatchObject({ label: 'USD balance', used: 0, limit: 10.5 });
  });

  it('returns empty when balance is missing', () => {
    expect(parseDeepSeekBalancePayload({ balance_infos: [{}] })).toEqual({
      rows: [],
      remainingDisplay: '',
    });
  });
});
