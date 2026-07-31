import { describe, expect, it } from 'vitest';

import {
  OPS_COMBO_PULSE_TTL_MS,
  OPS_COMBO_WINDOW_MS,
  computeOpsComboPulse,
  formatOpsComboFooterBadge,
  shouldOpsComboPulse,
} from '#/tui/utils/ops/ops-combo-pulse';

describe('shouldOpsComboPulse', () => {
  const now = 1_000_000;

  it('aligns when goal-xp, cache ok, and fleet flourish share a 10s window', () => {
    expect(
      shouldOpsComboPulse({
        goalXp: { atMs: now - 3_000 },
        cacheOk: true,
        fleetOk: { atMs: now - 1_000 },
        now,
      }),
    ).toEqual({ atMs: now - 1_000, score: 3 });
  });

  it('rejects missing signals, cache miss, or stale timestamps', () => {
    const base = {
      goalXp: { atMs: now - 1_000 },
      cacheOk: true,
      fleetOk: { atMs: now - 500 },
      now,
    };
    expect(shouldOpsComboPulse({ ...base, cacheOk: false })).toBeNull();
    expect(shouldOpsComboPulse({ ...base, goalXp: null })).toBeNull();
    expect(shouldOpsComboPulse({ ...base, fleetOk: undefined })).toBeNull();
    expect(
      shouldOpsComboPulse({
        ...base,
        goalXp: { atMs: now - OPS_COMBO_WINDOW_MS - 1 },
      }),
    ).toBeNull();
    expect(
      shouldOpsComboPulse({
        goalXp: { atMs: now - 1_000 },
        cacheOk: true,
        fleetOk: { atMs: now - OPS_COMBO_WINDOW_MS - 1 },
        now,
      }),
    ).toBeNull();
  });
});

describe('computeOpsComboPulse', () => {
  const now = 2_000_000;

  it('returns combo while within pulse TTL and skips runtimeDegraded', () => {
    const state = {
      goalXpPulse: { atMs: now - 500 },
      fleetFlourish: { atMs: now - 200 },
      cacheMeter: { rate: 0.995, streak: 4 },
      runtimeDegraded: null,
    };
    expect(computeOpsComboPulse(state, now)).toEqual({ atMs: now - 200, score: 3 });
    expect(
      computeOpsComboPulse(
        { ...state, runtimeDegraded: { scope: 'llm', reason: 'down', atMs: now - 100 } },
        now,
      ),
    ).toBeNull();
  });

  it('expires after combo pulse TTL', () => {
    const atMs = now - OPS_COMBO_PULSE_TTL_MS;
    expect(
      computeOpsComboPulse(
        {
          goalXpPulse: { atMs: atMs - 1_000 },
          fleetFlourish: { atMs },
          cacheMeter: { rate: 1, streak: 3 },
          runtimeDegraded: null,
        },
        now,
      ),
    ).toBeNull();
  });
});

describe('formatOpsComboFooterBadge', () => {
  const atMs = 3_000_000;

  it('shows combo×N within TTL', () => {
    expect(
      formatOpsComboFooterBadge({ atMs, score: 3 }, atMs + OPS_COMBO_PULSE_TTL_MS - 1),
    ).toEqual({ text: 'combo×3', severity: 'info' });
  });

  it('hides at and after TTL', () => {
    expect(formatOpsComboFooterBadge({ atMs, score: 3 }, atMs + OPS_COMBO_PULSE_TTL_MS)).toBeNull();
  });
});
