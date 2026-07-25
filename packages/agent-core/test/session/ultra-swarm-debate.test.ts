import { strict as assert } from 'node:assert';
import { describe, test } from 'vitest';

import {
  addDebateTurn,
  allDebatesFinished,
  assessRisk,
  buildDebateContext,
  createDebate,
  debatePhasesForRisk,
  findPendingDebateForExpert,
  injectSteering,
  parseConsensusVerdict,
  runDebateCycle,
  stanceForPhase,
  type DebateConfig,
  type DebateTurn,
  type DebateParticipant,
} from '../../src/session/ultra-swarm-debate';

function makeConfig(): DebateConfig {
  return {
    workNodeId: 'ac_1',
    criticExpertId: 'critic-1',
    criticExpertName: 'Critic',
    authorExpertId: 'author-1',
    authorExpertName: 'Author',
    artifactSummary: 'Implemented the foo() function in bar.ts',
  };
}

function makeTurn(
  debateId: string,
  phase: 'critic' | 'rebuttal' | 'counter-critique' | 'consensus',
  expertId: string,
  expertName: string,
  text: string,
  stance: 'support' | 'oppose' | 'neutral' = 'oppose',
): DebateTurn {
  return { debateId, workNodeId: 'ac_1', phase, expertId, expertName, text, stance };
}

describe('ultra-swarm-debate — createDebate', () => {
  test('initializes with critic phase and no turns', () => {
    const state = createDebate(makeConfig());
    assert.equal(state.currentPhase, 'critic');
    assert.equal(state.turns.length, 0);
    assert.equal(state.finished, false);
    assert.ok(state.debateId.length > 0);
  });
});

describe('ultra-swarm-debate — addDebateTurn', () => {
  test('advances from critic to rebuttal after both participants speak', () => {
    const state = createDebate(makeConfig());
    const criticTurn = makeTurn(state.debateId, 'critic', 'critic-1', 'Critic', 'Missing edge case for null input');
    const authorTurn = makeTurn(state.debateId, 'critic', 'author-1', 'Author', 'Good point, I will add null check', 'support');

    let next = addDebateTurn(state, criticTurn);
    assert.equal(next.currentPhase, 'critic');

    next = addDebateTurn(next, authorTurn);
    assert.equal(next.currentPhase, 'rebuttal');
  });

  test('reaches consensus after all 4 phases', () => {
    const state = createDebate(makeConfig());
    const turns: DebateTurn[] = [
      makeTurn(state.debateId, 'critic', 'critic-1', 'Critic', 'Gap 1'),
      makeTurn(state.debateId, 'critic', 'author-1', 'Author', 'Fix 1', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'author-1', 'Author', 'Defense', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'critic-1', 'Critic', 'Counter'),
      makeTurn(state.debateId, 'counter-critique', 'critic-1', 'Critic', 'Still gap'),
      makeTurn(state.debateId, 'counter-critique', 'author-1', 'Author', 'Will fix', 'support'),
      makeTurn(state.debateId, 'consensus', 'critic-1', 'Critic', 'Approved with minor fix', 'neutral'),
    ];

    let next = state;
    for (const turn of turns) {
      next = addDebateTurn(next, turn);
    }

    assert.equal(next.finished, true);
    assert.equal(next.consensusVerdict, 'Approved with minor fix');
  });

  test('does not add turns after debate is finished', () => {
    const state = createDebate(makeConfig());
    // Advance through all phases to reach consensus
    const turns: DebateTurn[] = [
      makeTurn(state.debateId, 'critic', 'critic-1', 'Critic', 'Gap 1'),
      makeTurn(state.debateId, 'critic', 'author-1', 'Author', 'Fix 1', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'author-1', 'Author', 'Defense', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'critic-1', 'Critic', 'Counter'),
      makeTurn(state.debateId, 'counter-critique', 'critic-1', 'Critic', 'Still gap'),
      makeTurn(state.debateId, 'counter-critique', 'author-1', 'Author', 'Will fix', 'support'),
    ];
    let next = state;
    for (const turn of turns) {
      next = addDebateTurn(next, turn);
    }
    const consensusTurn = makeTurn(state.debateId, 'consensus', 'critic-1', 'Critic', 'Done', 'neutral');
    next = addDebateTurn(next, consensusTurn);
    const extra = addDebateTurn(next, consensusTurn);
    assert.equal(extra.turns.length, 7);
  });
});

describe('ultra-swarm-debate — injectSteering', () => {
  test('stores user steering messages', () => {
    const state = createDebate(makeConfig());
    const steered = injectSteering(state, 'Focus on performance');
    assert.equal(steered.steeringMessages.length, 1);
    assert.equal(steered.steeringMessages[0], 'Focus on performance');
  });

  test('accumulates multiple steering messages', () => {
    const state = createDebate(makeConfig());
    let next = injectSteering(state, 'Message 1');
    next = injectSteering(next, 'Message 2');
    assert.equal(next.steeringMessages.length, 2);
  });
});

describe('ultra-swarm-debate — buildDebateContext', () => {
  test('includes artifact and phase in the context', () => {
    const state = createDebate(makeConfig());
    const context = buildDebateContext(state, 'critic-1');
    assert.ok(context.includes('ac_1'));
    assert.ok(context.includes('foo() function'));
    assert.ok(context.includes('current_phase>critic'));
  });

  test('includes prior turns after they are added', () => {
    const state = createDebate(makeConfig());
    const turn = makeTurn(state.debateId, 'critic', 'critic-1', 'Critic', 'Found a bug');
    const withTurn = addDebateTurn(state, turn);
    const context = buildDebateContext(withTurn, 'author-1');
    assert.ok(context.includes('Found a bug'));
    assert.ok(context.includes('Critic'));
  });

  test('includes steering messages in context', () => {
    const state = createDebate(makeConfig());
    const steered = injectSteering(state, 'Check the error handling');
    const context = buildDebateContext(steered, 'critic-1');
    assert.ok(context.includes('User Steering'));
    assert.ok(context.includes('Check the error handling'));
  });
});

describe('ultra-swarm-debate — stanceForPhase', () => {
  test('critic opposes during critic phase', () => {
    assert.equal(stanceForPhase('critic', true), 'oppose');
  });

  test('author supports during rebuttal phase', () => {
    assert.equal(stanceForPhase('rebuttal', false), 'support');
  });

  test('consensus is neutral for both', () => {
    assert.equal(stanceForPhase('consensus', true), 'neutral');
    assert.equal(stanceForPhase('consensus', false), 'neutral');
  });
});

describe('ultra-swarm-debate — findPendingDebateForExpert', () => {
  test('returns debate where critic should speak first in critic phase', () => {
    const state = createDebate(makeConfig());
    const found = findPendingDebateForExpert([state], 'critic-1');
    assert.ok(found);
    assert.equal(found.debateId, state.debateId);
  });

  test('returns undefined for author during first critic turn', () => {
    const state = createDebate(makeConfig());
    const found = findPendingDebateForExpert([state], 'author-1');
    assert.equal(found, undefined);
  });

  test('returns undefined when all debates are finished', () => {
    const state = createDebate(makeConfig());
    const turns: DebateTurn[] = [
      makeTurn(state.debateId, 'critic', 'critic-1', 'Critic', 'Gap 1'),
      makeTurn(state.debateId, 'critic', 'author-1', 'Author', 'Fix 1', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'author-1', 'Author', 'Defense', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'critic-1', 'Critic', 'Counter'),
      makeTurn(state.debateId, 'counter-critique', 'critic-1', 'Critic', 'Still gap'),
      makeTurn(state.debateId, 'counter-critique', 'author-1', 'Author', 'Will fix', 'support'),
    ];
    let next = state;
    for (const turn of turns) {
      next = addDebateTurn(next, turn);
    }
    const consensusTurn = makeTurn(state.debateId, 'consensus', 'critic-1', 'Critic', 'Done', 'neutral');
    next = addDebateTurn(next, consensusTurn);
    const found = findPendingDebateForExpert([next], 'critic-1');
    assert.equal(found, undefined);
  });
});

describe('ultra-swarm-debate — allDebatesFinished', () => {
  test('returns true when all debates are finished', () => {
    const state = createDebate(makeConfig());
    // Advance through all phases to reach consensus
    const turns: DebateTurn[] = [
      makeTurn(state.debateId, 'critic', 'critic-1', 'Critic', 'Gap 1'),
      makeTurn(state.debateId, 'critic', 'author-1', 'Author', 'Fix 1', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'author-1', 'Author', 'Defense', 'support'),
      makeTurn(state.debateId, 'rebuttal', 'critic-1', 'Critic', 'Counter'),
      makeTurn(state.debateId, 'counter-critique', 'critic-1', 'Critic', 'Still gap'),
      makeTurn(state.debateId, 'counter-critique', 'author-1', 'Author', 'Will fix', 'support'),
    ];
    let next = state;
    for (const turn of turns) {
      next = addDebateTurn(next, turn);
    }
    // Now in consensus phase — add the final turn
    const consensusTurn = makeTurn(state.debateId, 'consensus', 'critic-1', 'Critic', 'Done', 'neutral');
    next = addDebateTurn(next, consensusTurn);
    assert.ok(allDebatesFinished([next]));
  });

  test('returns false when any debate is not finished', () => {
    const state = createDebate(makeConfig());
    assert.ok(!allDebatesFinished([state]));
  });
});

describe('ultra-swarm-debate — assessRisk', () => {
  test('returns simple for low-risk nodes', () => {
    assert.equal(
      assessRisk({ nodeTitle: 'Fix typo', nodeDependsOnCount: 0, nodeRequiredEvidenceCount: 1 }),
      'simple',
    );
  });

  test('returns medium for nodes with dependencies', () => {
    assert.equal(
      assessRisk({ nodeTitle: 'Add feature', nodeDependsOnCount: 2, nodeRequiredEvidenceCount: 3 }),
      'medium',
    );
  });

  test('returns complex for high-risk nodes', () => {
    assert.equal(
      assessRisk({ nodeTitle: 'Refactor architecture', nodeDependsOnCount: 6, nodeRequiredEvidenceCount: 5, estimatedFileCount: 12 }),
      'complex',
    );
  });

  test('returns complex for many estimated files', () => {
    assert.equal(
      assessRisk({ nodeTitle: 'Large refactor', nodeDependsOnCount: 0, nodeRequiredEvidenceCount: 1, estimatedFileCount: 10 }),
      'complex',
    );
  });
});

describe('ultra-swarm-debate — debatePhasesForRisk', () => {
  test('simple risk skips heavy debate (empty phases)', () => {
    const phases = debatePhasesForRisk('simple');
    assert.equal(phases.length, 0);
  });

  test('medium risk gets 3 phases', () => {
    const phases = debatePhasesForRisk('medium');
    assert.equal(phases.length, 3);
    assert.ok(phases.includes('rebuttal'));
  });

  test('complex risk gets all 4 phases', () => {
    const phases = debatePhasesForRisk('complex');
    assert.equal(phases.length, 4);
    assert.ok(phases.includes('counter-critique'));
  });
});

describe('ultra-swarm-debate — parseConsensusVerdict', () => {
  test('parses approve', () => {
    const result = parseConsensusVerdict('approve: the approach is solid');
    assert.equal(result.verdict, 'approve');
  });

  test('parses strong-approve', () => {
    const result = parseConsensusVerdict('strong-approve: excellent work');
    assert.equal(result.verdict, 'approve');
  });

  test('parses block', () => {
    const result = parseConsensusVerdict('block: critical security issue');
    assert.equal(result.verdict, 'block');
  });

  test('parses reject as block', () => {
    const result = parseConsensusVerdict('reject: not acceptable');
    assert.equal(result.verdict, 'block');
  });

  test('parses case-insensitive VERDICT prefix', () => {
    const result = parseConsensusVerdict('VERDICT: PASS — looks good');
    assert.equal(result.verdict, 'approve');
  });

  test('parses Korean verdict variants', () => {
    assert.equal(parseConsensusVerdict('판정: 승인 — 문제 없음').verdict, 'approve');
    assert.equal(parseConsensusVerdict('차단: 보안 이슈').verdict, 'block');
    assert.equal(parseConsensusVerdict('수정 필요: 엣지 케이스').verdict, 'revise');
  });

  test('defaults to revise', () => {
    const result = parseConsensusVerdict('needs more work on edge cases');
    assert.equal(result.verdict, 'revise');
    assert.ok(result.revisionNotes !== undefined);
  });
});

describe('ultra-swarm-debate — runDebateCycle', () => {
  test('simple risk skips debate without calling LLM', async () => {
    const config = makeConfig();
    const debate = createDebate(config);
    let calls = 0;

    const critic: DebateParticipant = {
      expertId: 'critic-1',
      expertName: 'Critic',
      generate: async () => {
        calls += 1;
        return 'should not run';
      },
    };
    const author: DebateParticipant = {
      expertId: 'author-1',
      expertName: 'Author',
      generate: async () => {
        calls += 1;
        return 'should not run';
      },
    };

    const result = await runDebateCycle({
      debate,
      critic,
      author,
      runId: 'test-run',
      parent: { emitEvent: () => {} } as any,
      phases: debatePhasesForRisk('simple'),
    });

    assert.ok(result.finished);
    assert.equal(calls, 0);
    assert.ok(result.consensusVerdict?.includes('skipped debate'));
  });

  test('buildDebateContext includes draft excerpt citation instruction', () => {
    const state = createDebate(makeConfig());
    const context = buildDebateContext(state, 'critic-1', {
      draftExcerpt: 'export function foo() { return 1 }',
    });
    assert.ok(context.includes('<draft_excerpt>'));
    assert.ok(context.includes('export function foo()'));
    assert.ok(context.includes('draft_excerpt') || context.includes('Cite specific'));
  });

  test('runs a complete complex debate cycle (4 phases)', async () => {
    const config = makeConfig();
    const debate = createDebate(config);

    const callLog: string[] = [];
    const critic: DebateParticipant = {
      expertId: 'critic-1',
      expertName: 'Critic',
      generate: async (prompt: string) => {
        callLog.push(`critic: ${prompt.slice(0, 50)}`);
        if (prompt.includes('final verdict')) return 'approve: after review';
        if (prompt.includes('final critique')) return 'Remaining concern: error handling';
        return 'Found gap: missing timeout handling';
      },
    };
    const author: DebateParticipant = {
      expertId: 'author-1',
      expertName: 'Author',
      generate: async (prompt: string) => {
        callLog.push(`author: ${prompt.slice(0, 50)}`);
        if (prompt.includes('Address each point')) return 'I will add timeout handling with retry logic';
        if (prompt.includes('Respond to the final critique')) return 'Acknowledged, will add explicit error handling';
        return 'I propose using modular architecture';
      },
    };

    const result = await runDebateCycle({
      debate,
      critic,
      author,
      runId: 'test-run',
      parent: { emitEvent: () => {} } as any,
      phases: debatePhasesForRisk('complex'),
    });

    assert.ok(result.finished);
    assert.equal(result.turns.length, 7); // 2+2+2+1 = 7 turns
    assert.ok(result.consensusVerdict!.includes('approve'));
    // Verify all 4 phases were executed
    const phasesSeen = new Set(result.turns.map((t) => t.phase));
    assert.ok(phasesSeen.has('critic'));
    assert.ok(phasesSeen.has('rebuttal'));
    assert.ok(phasesSeen.has('counter-critique'));
    assert.ok(phasesSeen.has('consensus'));
  });

  test('steering messages appear in debate context for participants', async () => {
    const config = makeConfig();
    let debate = createDebate(config);
    debate = injectSteering(debate, 'Focus on performance optimization');

    const capturedPrompts: string[] = [];
    const critic: DebateParticipant = {
      expertId: 'critic-1',
      expertName: 'Critic',
      generate: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return 'approve: ok';
      },
    };
    const author: DebateParticipant = {
      expertId: 'author-1',
      expertName: 'Author',
      generate: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return 'I will optimize for performance';
      },
    };

    await runDebateCycle({
      debate,
      critic,
      author,
      runId: 'test-run',
      parent: { emitEvent: () => {} } as any,
      phases: debatePhasesForRisk('medium'),
    });

    // At least one participant should have seen the steering message
    const hasSteering = capturedPrompts.some((p) => p.includes('Focus on performance optimization'));
    assert.ok(hasSteering, 'Steering message should appear in at least one participant prompt');
  });
});