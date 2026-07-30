import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatProviderRouteSummary,
  providerRouteRows,
} from '#/tui/components/messages/status-panel/provider-route';

describe('status panel provider route formatting', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('summarizes ready and cooling candidates', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const summary = formatProviderRouteSummary({
      modelAlias: 'k2',
      strategy: 'round_robin',
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          providerModel: 'gpt-primary',
          cooldownUntil: now + 60_000,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          providerModel: 'gpt-backup',
        },
      ],
    });

    expect(summary).toBe('round_robin 1/2 ready; 1 cooling');
  });

  it('builds candidate rows with cooling severity and hidden overflow', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const rows = providerRouteRows({
      modelAlias: 'k2',
      strategy: 'round_robin',
      candidates: [
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:1',
          providerModel: 'gpt-primary',
          weight: 3,
          rateLimits: [
            {
              name: 'requests',
              limit: 100,
              remaining: 0,
              resetAt: now + 60_000,
            },
          ],
          rateLimitHeadroom: 0,
          cooldownUntil: now + 60_000,
          cooldownKind: 'rate_limit',
          avgLatencyMs: 140,
          failureCount: 1,
        },
        {
          modelAlias: 'k2',
          providerName: 'openai',
          credentialLabel: 'api_key:2',
          providerModel: 'gpt-backup',
          successCount: 3,
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          modelAlias: 'k2',
          providerName: 'openai',
          providerModel: `overflow-${String(index)}`,
        })),
      ],
    });

    expect(rows[0]).toEqual({
      label: 'Strategy',
      value: 'round_robin 7/8 ready; 1 cooling',
    });
    expect(rows[1]?.severity).toBe('error');
    expect(rows[1]?.value).toMatch(
      /cooling rate_limit .* openai:api_key:1 -> k2\/gpt-primary weight 3 latency 140ms headroom 0% \[requests:0\/100@1m\] \(fail 1\)/,
    );
    expect(rows[2]?.value).toMatch(/ready openai:api_key:2 -> k2\/gpt-backup \(ok 3\)/);
    expect(rows.at(-1)).toEqual({ label: 'More', value: '2 more candidates' });
  });
});
