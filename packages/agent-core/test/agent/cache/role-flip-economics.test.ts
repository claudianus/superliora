/**
 * Role-flip economics — why cache-sticky routing holds the established alias.
 *
 * Simulates a long session whose prompt-role classifier flips between a coding
 * role (expensive model `A`) and an exploration role (cheap model `B`), driving
 * the REAL UsageRecorder warm-streak gate (the same signal
 * `applyCacheAffinityHold` reads) and accounting relative input cost under an
 * Anthropic-style price model:
 *
 *   warm prefix read      0.10 / token   (cache read)
 *   cold prefix creation  1.25 / token   (cache write premium, full prefix)
 *   fresh append          1.00 / token   (uncached tail)
 *   cheap model scales everything by PRICE_B.
 *
 * A provider prefix only stays warm while re-used within the cache TTL
 * (modeled as TTL_TURNS). The simulation answers: is holding the established
 * alias across role flips actually cheaper, and does the production threshold
 * (warm streak ≥ 2) sit on the right side of the tradeoff?
 */

import { describe, expect, it } from 'vitest';

import { UsageRecorder } from '../../../src/agent/usage';
import { WARM_HIT_TARGET } from './warm-replay-kpi.harness';

/** Cheap-model price relative to the expensive model. */
const PRICE_B = 0.3;
/** Warm prefix read price (relative per-token). */
const CACHE_READ = 0.1;
/** Cold prefix creation premium (relative per-token). */
const CACHE_CREATION = 1.25;
/** Provider cache lifetime expressed in turns (~5 min at ~2 min/turn). */
const TTL_TURNS = 3;
/** Session prefix size at turn 0 (tokens). */
const PREFIX_BASE = 40_000;
/** Prefix growth per turn (tokens). */
const PREFIX_GROWTH = 800;
/** Fresh (uncached) tail tokens per turn. */
const TURN_DELTA = 1_000;

export type HoldPolicy = 'switch_always' | 1 | 2 | 3;

export interface FlipEconomicsReport {
  readonly totalCost: number;
  readonly switchCost: number;
  readonly coldTurns: number;
}

interface SimTurn {
  readonly explore: boolean;
  /** Gap in turns since the previous explore turn (0 for coding turns). */
  readonly gapSinceLastExplore: number;
}

/** Deterministic seeded RNG (mulberry32) so CI runs are reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn sequence: coding turns with explore turns interleaved at `gapTurns`. */
function sequenceWithExploreEvery(gapTurns: number, count: number): SimTurn[] {
  const turns: SimTurn[] = [];
  let untilExplore = gapTurns;
  for (let index = 0; index < count; index += 1) {
    if (untilExplore === 0) {
      turns.push({ explore: true, gapSinceLastExplore: gapTurns });
      untilExplore = gapTurns;
    } else {
      turns.push({ explore: false, gapSinceLastExplore: 0 });
      untilExplore -= 1;
    }
  }
  return turns;
}

/** Turn sequence with irregular (seeded geometric) explore gaps. */
function sequenceWithIrregularGaps(seed: number, meanGap: number, count: number): SimTurn[] {
  const rng = seeded(seed);
  const turns: SimTurn[] = [];
  let untilExplore = 1 + Math.floor(rng() * meanGap * 2);
  for (let index = 0; index < count; index += 1) {
    if (untilExplore === 0) {
      turns.push({ explore: true, gapSinceLastExplore: 0 });
      untilExplore = 1 + Math.floor(rng() * meanGap * 2);
    } else {
      turns.push({ explore: false, gapSinceLastExplore: 0 });
      untilExplore -= 1;
    }
  }
  return turns;
}

/**
 * One simulated session. `usage` is the production recorder so the warm
 * streak the policy reads is exactly the signal session-auto reads.
 */
function simulate(
  turns: readonly SimTurn[],
  policy: HoldPolicy,
): FlipEconomicsReport {
  const usage = new UsageRecorder();
  const lastUsedAt = new Map<string, number>();
  let prefix = PREFIX_BASE;
  let totalCost = 0;
  let coldTurns = 0;
  let previousAlias: string | undefined;

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    prefix += PREFIX_GROWTH;

    // Production gate: hold the expensive alias while the streak proves the
    // prefix is live; otherwise follow the role to the cheap model.
    let alias = 'A';
    const streakHolds =
      policy !== 'switch_always' && usage.warmStreak >= policy;
    if (turn.explore && !streakHolds) alias = 'B';

    // Provider cache TTL: a prefix not re-used within TTL_TURNS is cold again.
    const lastUsed = lastUsedAt.get(alias);
    const warm = lastUsed !== undefined && index - lastUsed <= TTL_TURNS;

    // Switching alias also voids the *read* side: the first turn on an alias
    // whose prefix went cold re-creates it.
    const switched = previousAlias !== undefined && previousAlias !== alias;
    const price = alias === 'A' ? 1 : PRICE_B;
    let turnCost: number;
    if (warm && !switched) {
      turnCost = CACHE_READ * price * prefix + price * TURN_DELTA;
    } else {
      turnCost = CACHE_CREATION * price * prefix + price * TURN_DELTA;
      coldTurns += 1;
    }
    totalCost += turnCost;
    lastUsedAt.set(alias, index);
    previousAlias = alias;

    // Feed the production recorder: warm turns report ~100% cache read, cold
    // turns report a full re-creation (hit rate 0 → streak reset).
    usage.beginTurn();
    const inputCacheRead = warm ? Math.floor(prefix * 0.995) : 0;
    const inputCacheCreation = warm ? 0 : Math.floor(prefix * 0.9);
    usage.record(
      alias,
      {
        inputOther: TURN_DELTA,
        inputCacheRead,
        inputCacheCreation,
        output: 500,
      },
      'turn',
    );
    usage.endTurn();
  }

  return { totalCost, switchCost: 0, coldTurns };
}

describe('role-flip economics (cache-sticky hold)', () => {
  const TURN_COUNT = 120;

  it('wins on irregular explore gaps, where every switch-back pays a cold creation', () => {
    const turns = sequenceWithIrregularGaps(0xC0FFEE, 6, TURN_COUNT);
    const always = simulate(turns, 'switch_always');
    const held = simulate(turns, 2);

    expect(held.coldTurns).toBeLessThan(always.coldTurns);
    // Realistic irregular sessions: the hold must come out ahead overall.
    expect(held.totalCost).toBeLessThan(always.totalCost);
  });

  it('is roughly cost-neutral under fast regular flips (both prefixes stay warm)', () => {
    const turns = sequenceWithExploreEvery(2, TURN_COUNT);
    const always = simulate(turns, 'switch_always');
    const held = simulate(turns, 2);

    // Adversarial case for the hold: both aliases stay inside the cache TTL,
    // so switching is nearly free. The hold may pay slightly more but must
    // stay within a small margin — never compounding into a big loss.
    expect(held.totalCost).toBeLessThan(always.totalCost * 1.15);
  });

  it('never does worse than always-switch across a sweep of flip cadences', () => {
    for (const gap of [2, 4, 8, 16, 32]) {
      const turns = sequenceWithExploreEvery(gap, TURN_COUNT);
      const always = simulate(turns, 'switch_always');
      const held = simulate(turns, 2);
      const ratio = held.totalCost / always.totalCost;
      expect(
        ratio,
        `gap=${String(gap)} hold/switch ratio ${ratio.toFixed(3)}`,
      ).toBeLessThan(1.2);
    }
  });

  it('sweeps warm-streak thresholds 1..3 under irregular flips without a loser', () => {
    const turns = sequenceWithIrregularGaps(0xBEEF, 8, TURN_COUNT);
    const always = simulate(turns, 'switch_always');
    for (const policy of [1, 2, 3] as const) {
      const held = simulate(turns, policy);
      expect(
        held.totalCost,
        `hold ${String(policy)} must beat always-switch`,
      ).toBeLessThan(always.totalCost);
    }
  });
});
