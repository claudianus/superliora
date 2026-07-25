import { describe, expect, it } from 'vitest';

import {
  createSwarmBudgetState,
  evaluateSwarmBudget,
  isWastedBudgetRound,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
} from '../../src/session/swarm-budget';

describe('swarm-budget', () => {
  it('treats empty evidence as wasted unless productive', () => {
    expect(isWastedBudgetRound({ evidenceIds: [] })).toBe(true);
    expect(isWastedBudgetRound({ evidenceIds: ['e1'] })).toBe(false);
    expect(isWastedBudgetRound({ evidenceIds: [], productive: true })).toBe(false);
    expect(isWastedBudgetRound({ wasted: true, evidenceIds: ['e1'] })).toBe(true);
  });

  it('suggests kill when wastedRounds >= default threshold (2)', () => {
    let state = createSwarmBudgetState();
    state = recordSwarmBudgetRound(state, { label: 'implement', evidenceIds: [] });
    expect(suggestSwarmBudgetKill(state).shouldKill).toBe(false);

    state = recordSwarmBudgetRound(state, { label: 'review', evidenceIds: [] });
    const suggestion = suggestSwarmBudgetKill(state);
    expect(suggestion.shouldKill).toBe(true);
    expect(suggestion.wastedRounds).toBe(2);
    expect(suggestion.reason).toMatch(/Budget governor|without evidence/i);
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
    expect(suggestion.reason).toMatch(/without evidence/i);
    expect(suggestion.reason).toMatch(/implement|threshold/i);
    expect(suggestion.wastedRounds).toBe(2);
    expect(suggestion.killThreshold).toBe(2);
  });
});
