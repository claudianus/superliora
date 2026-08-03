import { describe, expect, it } from 'vitest';

import {
  createLinkedAbortController,
  formatBudgetKillHandoff,
} from '../../../../src/tools/builtin/fleet/ultra-swarm';
import {
  createSwarmBudgetState,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
} from '#/fleet';

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
    expect(xml).toContain('close verification gaps');
    expect(xml).toContain('requiredEvidence');
    expect(xml).toContain('fileChangeCount');
  });

  it('formatBudgetKillHandoff surfaces the last few round verdicts in a trail', () => {
    const xml = formatBudgetKillHandoff({
      reason: 'Budget governor: 3 consecutive rounds without high-signal progress',
      phase: 'implement',
      wastedRounds: 3,
      killThreshold: 2,
      lastRounds: [
        { label: 'plan', wasted: false, evidenceCount: 1, toolSuccessCount: 2 },
        { label: 'implement', wasted: true, evidenceCount: 0, toolSuccessCount: 0 },
        { label: 'review', wasted: true, evidenceCount: 0, toolSuccessCount: 1 },
        { label: 'implement-retry', wasted: true, evidenceCount: 0, toolSuccessCount: 0 },
      ],
      maxRounds: 3,
    });
    expect(xml).toContain('Last rounds:');
    // Truncates to 3 newest, so plan should be dropped.
    expect(xml).not.toContain('plan=productive');
    expect(xml).toContain('implement=wasted');
    expect(xml).toContain('review=wasted (tools 1)');
    expect(xml).toContain('implement-retry=wasted');
    // The bare wasted round carries no signal suffix.
    expect(xml).not.toMatch(/implement=wasted \(/);
  });

  it('formatBudgetKillHandoff omits the trail when no history is provided', () => {
    const xml = formatBudgetKillHandoff({
      reason: 'Budget governor: 2 consecutive rounds without high-signal progress',
      phase: 'review',
      wastedRounds: 2,
      killThreshold: 2,
    });
    expect(xml).not.toContain('Last rounds:');
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
