import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WASTED_ROUNDS_KILL_THRESHOLD,
  createSwarmBudgetState,
  evaluateSwarmBudget,
  hasHighSignalBudgetProgress,
  isWastedBudgetRound,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
} from '../../src/collaboration/swarm-budget';

describe('swarm-budget.ts — high-signal detection', () => {
  describe('hasHighSignalBudgetProgress', () => {
    it('returns false for an empty round', () => {
      expect(hasHighSignalBudgetProgress({})).toBe(false);
    });

    it('treats productive alone as NOT high-signal (anti-gaming)', () => {
      expect(hasHighSignalBudgetProgress({ productive: true })).toBe(false);
    });

    it('flips high-signal for any of the documented artifacts', () => {
      expect(hasHighSignalBudgetProgress({ evidenceIds: ['e-1'] })).toBe(true);
      expect(hasHighSignalBudgetProgress({ artifactIds: ['a-1'] })).toBe(true);
      expect(hasHighSignalBudgetProgress({ fileChangeCount: 1 })).toBe(true);
      expect(hasHighSignalBudgetProgress({ toolSuccessCount: 1 })).toBe(true);
      expect(hasHighSignalBudgetProgress({ verificationPassed: true })).toBe(true);
    });

    it('ignores empty-string evidence/artifact ids (trim filter)', () => {
      expect(hasHighSignalBudgetProgress({ evidenceIds: ['', '   '] })).toBe(false);
      expect(hasHighSignalBudgetProgress({ artifactIds: [''] })).toBe(false);
    });
  });

  describe('isWastedBudgetRound', () => {
    it('returns true for an empty round (default wasted)', () => {
      expect(isWastedBudgetRound({})).toBe(true);
    });

    it('returns true for explicit wasted without any high-signal artifact', () => {
      expect(isWastedBudgetRound({ wasted: true, productive: true })).toBe(true);
    });

    it('returns false when high-signal wins over an explicit wasted flag', () => {
      expect(isWastedBudgetRound({ wasted: true, toolSuccessCount: 2 })).toBe(false);
      expect(isWastedBudgetRound({ wasted: true, verificationPassed: true })).toBe(false);
      expect(isWastedBudgetRound({ wasted: true, evidenceIds: ['e-1'] })).toBe(false);
    });
  });
});

describe('swarm-budget.ts — state recording', () => {
  it('defaults the kill threshold to 2 and clamps below to 1', () => {
    expect(createSwarmBudgetState().killThreshold).toBe(DEFAULT_WASTED_ROUNDS_KILL_THRESHOLD);
    expect(createSwarmBudgetState({ killThreshold: 0 }).killThreshold).toBe(1);
    expect(createSwarmBudgetState({ killThreshold: 5 }).killThreshold).toBe(5);
  });

  it('records a productive round and resets the consecutive-wasted counter', () => {
    const s0 = createSwarmBudgetState();
    const s1 = recordSwarmBudgetRound(s0, { evidenceIds: ['e-1'] });
    expect(s1.rounds).toBe(1);
    expect(s1.wastedRounds).toBe(0);
    expect(s1.consecutiveWastedRounds).toBe(0);
    expect(s1.evidenceCount).toBe(1);
    expect(s1.history).toHaveLength(1);
  });

  it('records a wasted round and increments wastedRounds + consecutiveWastedRounds', () => {
    const s1 = recordSwarmBudgetRound(createSwarmBudgetState(), { wasted: true });
    const s2 = recordSwarmBudgetRound(s1, { wasted: true });
    expect(s2.rounds).toBe(2);
    expect(s2.wastedRounds).toBe(2);
    expect(s2.consecutiveWastedRounds).toBe(2);
  });

  it('clamps negative fileChangeCount/toolSuccessCount to 0', () => {
    const s = recordSwarmBudgetRound(createSwarmBudgetState(), {
      fileChangeCount: -5,
      toolSuccessCount: -3,
    });
    expect(s.history[0]?.fileChangeCount).toBe(0);
    expect(s.history[0]?.toolSuccessCount).toBe(0);
  });

  it('preserves the last round label (only the most recent label wins)', () => {
    let s = createSwarmBudgetState();
    s = recordSwarmBudgetRound(s, { label: 'first', evidenceIds: ['e-1'] });
    s = recordSwarmBudgetRound(s, { label: 'second', evidenceIds: ['e-2'] });
    expect(s.lastRoundLabel).toBe('second');
  });
});

describe('swarm-budget.ts — kill suggestion', () => {
  it('does not kill below the threshold and reports the continue reason', () => {
    const s = recordSwarmBudgetRound(createSwarmBudgetState(), { wasted: true });
    const sug = suggestSwarmBudgetKill(s);
    expect(sug.shouldKill).toBe(false);
    expect(sug.reason).toMatch(/continue/);
  });

  it('kills when total wasted rounds cross the kill threshold', () => {
    const s0 = createSwarmBudgetState();
    const s1 = recordSwarmBudgetRound(s0, { label: 'r1', wasted: true });
    const s2 = recordSwarmBudgetRound(s1, { label: 'r2', wasted: true });
    const sug = suggestSwarmBudgetKill(s2);
    expect(sug.shouldKill).toBe(true);
    // Two consecutive wasted rounds at threshold 2 hit the consecutive
    // branch first — the reason message must still surface both the count
    // and the last round label.
    expect(sug.reason).toMatch(/2 consecutive rounds without high-signal progress/);
    expect(sug.reason).toMatch(/last: r2/);
  });

  it('kills when consecutive wasted rounds cross the threshold even if total is below', () => {
    let s = createSwarmBudgetState({ killThreshold: 2 });
    s = recordSwarmBudgetRound(s, { wasted: true });
    s = recordSwarmBudgetRound(s, { evidenceIds: ['e-1'] });
    s = recordSwarmBudgetRound(s, { wasted: true });
    s = recordSwarmBudgetRound(s, { wasted: true });
    const sug = suggestSwarmBudgetKill(s);
    expect(sug.shouldKill).toBe(true);
    expect(sug.reason).toMatch(/2 consecutive rounds without high-signal progress/);
  });

  it('evaluateSwarmBudget folds a sequence and reports the final suggestion', () => {
    const { state, suggestion } = evaluateSwarmBudget([
      { label: 'a', evidenceIds: ['e-1'] },
      { wasted: true, label: 'b' },
      { wasted: true, label: 'c' },
    ]);
    expect(state.rounds).toBe(3);
    expect(state.wastedRounds).toBe(2);
    expect(suggestion.shouldKill).toBe(true);
  });
});
