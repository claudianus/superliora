import { describe, expect, it } from 'vitest';

import {
  resolveBreakerFromAppState,
  resolveBreakerStatus,
  resolveNeverHaltBreakerLines,
  resolveOpsBreakerLine,
  resolveOpsBreakerLineFromAppState,
} from '#/tui/utils/never-halt/breaker-glance';

const liveBreakers = {
  closed: 2,
  open: 1,
  halfOpen: 0,
  lastTripReason: 'brave 429',
  scopes: [{ id: 'search:brave', state: 'open', failures: 3, lastTripReason: '429 burst' }],
};

describe('resolveBreakerFromAppState', () => {
  it('returns breakers when AppState snapshot is populated', () => {
    expect(resolveBreakerFromAppState(liveBreakers)).toEqual(liveBreakers);
  });

  it('returns undefined when AppState has no breaker snapshot', () => {
    expect(resolveBreakerFromAppState(undefined)).toBeUndefined();
    expect(resolveBreakerFromAppState(null)).toBeUndefined();
  });
});

describe('resolveBreakerStatus', () => {
  it('prefers live getStatus over AppState', () => {
    expect(
      resolveBreakerStatus({
        appStateBreakers: { closed: 0, open: 9, halfOpen: 0 },
        statusBreakers: liveBreakers,
      }),
    ).toEqual(liveBreakers);
  });

  it('falls back to AppState when getStatus is absent', () => {
    expect(
      resolveBreakerStatus({
        appStateBreakers: liveBreakers,
      }),
    ).toEqual(liveBreakers);
  });
});

describe('resolveNeverHaltBreakerLines', () => {
  it('shows lastTrip from AppState registry when getStatus is unavailable', () => {
    const lines = resolveNeverHaltBreakerLines({
      appStateBreakers: liveBreakers,
      degraded: null,
    });
    expect(lines.some((line) => line.includes('Last trip: brave 429'))).toBe(true);
    expect(lines.some((line) => line.includes('search:brave: open'))).toBe(true);
  });
});

describe('resolveOpsBreakerLineFromAppState', () => {
  it('formats open count from AppState SSOT for Ops Runtime Health', () => {
    const line = resolveOpsBreakerLineFromAppState(liveBreakers, null);
    expect(line).toBe('Breakers: 1 open · 2 closed · last: brave 429');
  });

  it('ignores getStatus and falls back to tip when AppState registry is absent', () => {
    const line = resolveOpsBreakerLineFromAppState(null, null);
    expect(line).toBe('Breakers: (no trips) · breakers: see /settings never-halt');
  });
});

describe('resolveOpsBreakerLine', () => {
  it('formats last trip from AppState between getStatus refreshes', () => {
    const line = resolveOpsBreakerLine({
      appStateBreakers: liveBreakers,
      degraded: null,
    });
    expect(line).toBe('Breakers: 1 open · 2 closed · last: brave 429');
  });
});
