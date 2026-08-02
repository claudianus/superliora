import { describe, expect, it } from 'vitest';

import {
  FLEET_FLOURISH_BADGE_TTL_MS,
  formatFleetFlourishFooterBadge,
  shouldFleetFlourishPulse,
} from '#/tui/utils/fleet/fleet-flourish';

describe('shouldFleetFlourishPulse', () => {
  it('pulses when a worker leaves running for completed', () => {
    const prev = [{ id: 'w1', status: 'running' }];
    const next = [{ id: 'w1', status: 'completed' }];
    expect(shouldFleetFlourishPulse(prev, next)).toBe(true);
  });

  it('pulses for idle/done terminal aliases', () => {
    const prev = [{ id: 'w1', status: 'running' }];
    expect(shouldFleetFlourishPulse(prev, [{ id: 'w1', status: 'idle' }])).toBe(true);
    expect(shouldFleetFlourishPulse(prev, [{ id: 'w1', status: 'done' }])).toBe(true);
  });

  it('skips first snapshot, unchanged running, and failed transitions', () => {
    const prev = [{ id: 'w1', status: 'running' }];
    expect(shouldFleetFlourishPulse(undefined, prev)).toBe(false);
    expect(shouldFleetFlourishPulse(prev, prev)).toBe(false);
    expect(shouldFleetFlourishPulse(prev, [{ id: 'w1', status: 'failed' }])).toBe(false);
    expect(shouldFleetFlourishPulse(prev, [{ id: 'w2', status: 'completed' }])).toBe(false);
  });
});

describe('formatFleetFlourishFooterBadge', () => {
  const atMs = 2_000_000;

  it('shows fleet✓ within TTL', () => {
    expect(
      formatFleetFlourishFooterBadge({ atMs }, atMs + FLEET_FLOURISH_BADGE_TTL_MS - 1, 'compact'),
    ).toEqual({ text: 'fleet✓', severity: 'info' });
  });

  it('hides at and after TTL', () => {
    expect(formatFleetFlourishFooterBadge({ atMs }, atMs + FLEET_FLOURISH_BADGE_TTL_MS)).toBeNull();
  });
});
