import { describe, expect, it } from 'vitest';

import {
  formatNeverHaltBreakerLines,
  formatOpsBreakerLine,
} from '#/tui/utils/never-halt/breaker-summary';

describe('breaker-summary', () => {
  it('formats ops line from sdk breaker counts', () => {
    const line = formatOpsBreakerLine(
      { closed: 2, open: 1, halfOpen: 0, lastTripReason: 'brave 429' },
      null,
    );
    expect(line).toBe('Breakers: 1 open · 2 closed · last: brave 429');
  });

  it('includes half-open count when > 0', () => {
    const line = formatOpsBreakerLine({ closed: 3, open: 1, halfOpen: 2 }, null);
    expect(line).toBe('Breakers: 1 open · 2 half · 3 closed');
  });

  it('falls back to runtimeDegraded when sdk status is absent', () => {
    const line = formatOpsBreakerLine(undefined, {
      scope: 'search',
      reason: 'paid_channels_cooling',
    });
    expect(line).toContain('search↓');
    expect(line).toContain('paid_channels_cooling');
    expect(line).toContain('breakers: see /settings never-halt');
  });

  it('lists scopes in never-halt settings when sdk status is present', () => {
    const lines = formatNeverHaltBreakerLines(
      {
        closed: 0,
        open: 1,
        halfOpen: 0,
        scopes: [{ id: 'brave', state: 'open', failures: 3, lastTripReason: '429 burst' }],
      },
      null,
    );
    expect(lines[0]).toContain('1 open');
    expect(lines.some((l) => l.includes('brave: open'))).toBe(true);
    expect(lines.some((l) => l.includes('Last trip: 429 burst'))).toBe(true);
  });
});
