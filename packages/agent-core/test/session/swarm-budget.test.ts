import { describe, expect, it } from 'vitest';

import {
  createSwarmBudgetState,
  evaluateSwarmBudget,
  hasHighSignalBudgetProgress,
  isWastedBudgetRound,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
} from '../../src/session/swarm-budget';

describe('swarm-budget', () => {
  it('treats empty progress as wasted; bare productive does not clear waste', () => {
    expect(isWastedBudgetRound({ evidenceIds: [] })).toBe(true);
    expect(isWastedBudgetRound({ evidenceIds: ['e1'] })).toBe(false);
    expect(isWastedBudgetRound({ evidenceIds: [], productive: true })).toBe(true);
    expect(isWastedBudgetRound({ artifactIds: ['a1'] })).toBe(false);
    expect(isWastedBudgetRound({ fileChangeCount: 2 })).toBe(false);
    expect(isWastedBudgetRound({ toolSuccessCount: 1 })).toBe(false);
    expect(isWastedBudgetRound({ wasted: true, evidenceIds: ['e1'] })).toBe(true);
  });

  it('hasHighSignalBudgetProgress requires real artifacts', () => {
    expect(hasHighSignalBudgetProgress({ productive: true })).toBe(false);
    expect(hasHighSignalBudgetProgress({ evidenceIds: ['x'] })).toBe(true);
  });

  it('suggests kill when wastedRounds >= default threshold (2)', () => {
    let state = createSwarmBudgetState();
    state = recordSwarmBudgetRound(state, { label: 'implement', evidenceIds: [] });
    expect(suggestSwarmBudgetKill(state).shouldKill).toBe(false);
    expect(state.consecutiveWastedRounds).toBe(1);

    state = recordSwarmBudgetRound(state, { label: 'review', evidenceIds: [] });
    const suggestion = suggestSwarmBudgetKill(state);
    expect(suggestion.shouldKill).toBe(true);
    expect(suggestion.wastedRounds).toBe(2);
    expect(suggestion.consecutiveWastedRounds).toBe(2);
    expect(suggestion.reason).toMatch(/Budget governor|high-signal|without/i);
  });

  it('resets consecutive waste after a high-signal round', () => {
    let state = createSwarmBudgetState();
    state = recordSwarmBudgetRound(state, { evidenceIds: [] });
    state = recordSwarmBudgetRound(state, { evidenceIds: ['e1'] });
    expect(state.consecutiveWastedRounds).toBe(0);
    expect(state.wastedRounds).toBe(1);
    expect(suggestSwarmBudgetKill(state).shouldKill).toBe(false);
  });

  it('does not kill when only one wasted round exists among productive work', () => {
    const { suggestion, state } = evaluateSwarmBudget([
      { label: 'plan', evidenceIds: [] },
      { label: 'implement', evidenceIds: ['test:unit'] },
      { label: 'review', evidenceIds: ['review:note'] },
    ]);
    expect(suggestion.shouldKill).toBe(false);
    expect(state.wastedRounds).toBe(1);
    expect(state.evidenceCount).toBe(2);
  });

  it('honors custom kill threshold', () => {
    const { suggestion } = evaluateSwarmBudget(
      [{ evidenceIds: [] }, { evidenceIds: [] }, { evidenceIds: [] }],
      { killThreshold: 3 },
    );
    expect(suggestion.shouldKill).toBe(true);
    expect(suggestion.killThreshold).toBe(3);
  });

  it('exposes a stable kill reason for visible handoff / telemetry', () => {
    const { suggestion } = evaluateSwarmBudget(
      [
        { label: 'plan', evidenceIds: [] },
        { label: 'implement', evidenceIds: [] },
      ],
      { killThreshold: 2 },
    );
    expect(suggestion.shouldKill).toBe(true);
    expect(suggestion.reason).toMatch(/Budget governor/i);
    expect(suggestion.reason).toMatch(/high-signal|without/i);
    expect(suggestion.reason).toMatch(/implement|threshold|consecutive/i);
    expect(suggestion.wastedRounds).toBe(2);
    expect(suggestion.killThreshold).toBe(2);
  });
});
