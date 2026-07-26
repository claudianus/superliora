import { describe, expect, it } from 'vitest';

import {
  createLinkedAbortController,
  formatBudgetKillHandoff,
} from '../../../../src/tools/builtin/collaboration/ultra-swarm';
import {
  createSwarmBudgetState,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
} from '../../../../src/session/swarm-budget';

describe('ultra-swarm budget kill helpers', () => {
  it('createLinkedAbortController aborts child when parent aborts', () => {
    const parent = new AbortController();
    const child = createLinkedAbortController(parent.signal);
    expect(child.signal.aborted).toBe(false);
    parent.abort(new Error('parent cancel'));
    expect(child.signal.aborted).toBe(true);
  });

  it('createLinkedAbortController can abort child without aborting parent', () => {
    const parent = new AbortController();
    const child = createLinkedAbortController(parent.signal);
    child.abort(new Error('budget kill'));
    expect(child.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  it('createLinkedAbortController starts aborted when parent already aborted', () => {
    const parent = new AbortController();
    parent.abort(new Error('already'));
    const child = createLinkedAbortController(parent.signal);
    expect(child.signal.aborted).toBe(true);
  });

  it('formatBudgetKillHandoff emits a visible budget_kill fragment', () => {
    const xml = formatBudgetKillHandoff({
      reason: 'Budget governor: 2 rounds without evidence (last: implement) >= threshold 2. Suggest kill.',
      phase: 'implement',
      wastedRounds: 2,
      killThreshold: 2,
    });
    expect(xml).toContain('<budget_kill');
    expect(xml).toContain('phase="implement"');
    expect(xml).toContain('wasted_rounds="2"');
    expect(xml).toContain('threshold="2"');
    expect(xml).toContain('Budget governor');
    expect(xml).toContain('Do not re-launch UltraSwarm');
    expect(xml).toContain('attach evidenceIds');
  });

  it('suggestSwarmBudgetKill + handoff compose the kill path contract', () => {
    let state = createSwarmBudgetState({ killThreshold: 2 });
    state = recordSwarmBudgetRound(state, { label: 'plan', evidenceIds: [] });
    state = recordSwarmBudgetRound(state, { label: 'implement', evidenceIds: [] });
    const suggestion = suggestSwarmBudgetKill(state);
    expect(suggestion.shouldKill).toBe(true);

    const handoff = formatBudgetKillHandoff({
      reason: suggestion.reason,
      phase: 'implement',
      wastedRounds: suggestion.wastedRounds,
      killThreshold: suggestion.killThreshold,
    });
    expect(handoff).toMatch(/budget_kill/);
    expect(handoff).toContain(String(suggestion.wastedRounds));
  });
});
