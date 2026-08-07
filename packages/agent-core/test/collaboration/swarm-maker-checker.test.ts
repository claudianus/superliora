import { describe, expect, it } from 'vitest';

import * as fleetSurface from '#/fleet';
import {
  applyMakerCheckerHardGate,
  classifyExpertRoleString,
  classifySwarmLaneRole,
  classifySwarmPhaseRole,
  detectBatchItemRoleCollision,
  detectMakerCheckerCollisions,
  detectMakerCheckerCollisionsFromAssignments,
  detectMakerCheckerCollisionsFromSwarmOutput,
  formatMakerCheckerSoftWarn,
  isMakerCheckerHardGateEnabled,
  isMakerCheckerHardReject,
  makerCheckerSoftWarnFromBatchItems,
  SWARM_MAKER_CHECKER_HARD_PREFIX,
  SWARM_MAKER_CHECKER_SOFT_TIP,
} from '#/fleet';

describe('swarm-maker-checker.ts — role classification', () => {
  it('maps swarm phases to maker vs checker', () => {
    expect(classifySwarmPhaseRole('implement')).toBe('maker');
    expect(classifySwarmPhaseRole('plan')).toBe('maker');
    expect(classifySwarmPhaseRole('review')).toBe('checker');
    expect(classifySwarmPhaseRole('review-revision')).toBe('checker');
  });

  it('maps coverage lanes using swarm lane heuristics', () => {
    expect(classifySwarmLaneRole('architecture_implementation')).toBe('maker');
    expect(classifySwarmLaneRole('testing_evidence')).toBe('checker');
    expect(classifySwarmLaneRole('security_privacy')).toBe('checker');
  });
});

describe('swarm-maker-checker.ts — expert collisions', () => {
  it('returns empty when experts stay maker-only or checker-only', () => {
    const results = detectMakerCheckerCollisionsFromAssignments([
      { expertId: 'a', expertName: 'Alpha', phase: 'implement' },
      { expertId: 'b', expertName: 'Bravo', phase: 'review' },
    ]);
    expect(results).toEqual([]);
  });

  it('flags when the same expert both implements and reviews', () => {
    const results = detectMakerCheckerCollisionsFromAssignments([
      { expertId: 'e-1', expertName: 'Solo Expert', phase: 'implement' },
      { expertId: 'e-1', expertName: 'Solo Expert', phase: 'review' },
    ]);
    expect(results).toEqual([
      {
        expertId: 'e-1',
        expertName: 'Solo Expert',
        makerPhase: 'implement',
        checkerPhase: 'review',
      },
    ]);
  });

  it('formats a soft warn tip with colliding expert names', () => {
    const tip = formatMakerCheckerSoftWarn([
      {
        expertId: 'e-1',
        expertName: 'Solo Expert',
        makerPhase: 'implement',
        checkerPhase: 'review',
      },
    ]);
    expect(tip).toContain(SWARM_MAKER_CHECKER_SOFT_TIP);
    expect(tip).toContain('Solo Expert');
    expect(tip).toContain('swarm-maker-checker');
  });
});

describe('swarm-maker-checker.ts — AgentSwarm homogeneous batch', () => {
  it('detects mixed implement/review intents in one item list', () => {
    expect(
      detectBatchItemRoleCollision([
        'Implement login route',
        'Review auth middleware for security gaps',
      ]),
    ).toBe(true);
  });

  it('does not warn when all items share one intent class', () => {
    expect(
      makerCheckerSoftWarnFromBatchItems(['Implement login route', 'Patch session store']),
    ).toBeUndefined();
  });
});

describe('swarm-maker-checker.ts — parse swarm output', () => {
  it('detects collisions from expert XML rows in tool output', () => {
    const output = [
      '<expert expert_id="e-1" name="Alpha" phase="implement" outcome="completed" verdict="PASS"></expert>',
      '<expert expert_id="e-1" name="Alpha" phase="review" outcome="completed" verdict="PASS"></expert>',
    ].join('\n');
    expect(detectMakerCheckerCollisionsFromSwarmOutput(output)).toEqual([
      {
        expertId: 'e-1',
        expertName: 'Alpha',
        makerPhase: 'implement',
        checkerPhase: 'review',
      },
    ]);
  });
});

describe('swarm-maker-checker.ts — detectMakerCheckerCollisions', () => {
  it('dedupes by expertId across assignment rows', () => {
    expect(
      detectMakerCheckerCollisions([
        { expertId: 'x', role: 'maker', phase: 'implement' },
        { expertId: 'x', role: 'checker', phase: 'review' },
      ]),
    ).toHaveLength(1);
  });
});

describe('swarm-maker-checker.ts — hard gate flag', () => {
  it('defaults hard gate off', () => {
    expect(isMakerCheckerHardGateEnabled({})).toBe(false);
    expect(isMakerCheckerHardGateEnabled({ SUPERLIORA_MAKER_CHECKER_HARD: '0' })).toBe(false);
  });

  it('enables hard gate via SUPERLIORA_MAKER_CHECKER_HARD or alias', () => {
    expect(isMakerCheckerHardGateEnabled({ SUPERLIORA_MAKER_CHECKER_HARD: '1' })).toBe(true);
    expect(isMakerCheckerHardGateEnabled({ maker_checker_hard_gate: 'true' })).toBe(true);
  });

  it('prefixes soft tips when hard gate is on', () => {
    const soft = makerCheckerSoftWarnFromBatchItems(
      ['Implement login route', 'Review auth middleware for security gaps'],
      undefined,
      { env: {} },
    );
    expect(soft).toBeDefined();
    expect(isMakerCheckerHardReject(soft)).toBe(false);

    const hard = makerCheckerSoftWarnFromBatchItems(
      ['Implement login route', 'Review auth middleware for security gaps'],
      undefined,
      { hardGate: true },
    );
    expect(hard).toContain(SWARM_MAKER_CHECKER_HARD_PREFIX);
    expect(isMakerCheckerHardReject(hard)).toBe(true);
    expect(hard).toContain(soft ?? '');
  });

  it('applyMakerCheckerHardGate is a no-op without tip', () => {
    expect(applyMakerCheckerHardGate(undefined, { hardGate: true })).toBeUndefined();
  });

  it('documents pre-spawn contract: hard reject is detectable before queue', () => {
    // Fleet fan-out callers check this before spawn/queue.
    const hard = makerCheckerSoftWarnFromBatchItems(
      ['Implement feature X', 'Review feature X for security'],
      undefined,
      { hardGate: true },
    );
    expect(isMakerCheckerHardReject(hard)).toBe(true);
    // Soft path must remain non-reject so default product behaviour is unchanged.
    const soft = makerCheckerSoftWarnFromBatchItems(
      ['Implement feature X', 'Review feature X for security'],
      undefined,
      { env: {} },
    );
    expect(isMakerCheckerHardReject(soft)).toBe(false);
  });

  it('formatMakerCheckerSoftWarn respects hardGate option', () => {
    const collisions = detectMakerCheckerCollisions([
      { expertId: 'x', role: 'maker', phase: 'implement' },
      { expertId: 'x', role: 'checker', phase: 'review' },
    ]);
    const soft = formatMakerCheckerSoftWarn(collisions, { env: {} });
    const hard = formatMakerCheckerSoftWarn(collisions, { hardGate: true });
    expect(soft).toContain(SWARM_MAKER_CHECKER_SOFT_TIP);
    expect(hard).toContain(SWARM_MAKER_CHECKER_HARD_PREFIX);
  });
});

describe('swarm-maker-checker.ts — retro guard (S3-R7)', () => {
  it('fleet surface no longer exposes retired UltraSwarm-named helpers', () => {
    const retired = Object.keys(fleetSurface).filter((key) => /UltraSwarm/i.test(key));
    expect(retired).toEqual([]);
  });

  it('classifies expert role strings via the role fallback', () => {
    expect(classifyExpertRoleString('Reviewer')).toBe('checker');
    expect(classifyExpertRoleString('implementer')).toBe('maker');
    expect(classifyExpertRoleString(undefined)).toBeUndefined();
    expect(classifyExpertRoleString('   ')).toBeUndefined();
  });

  it('uses focus when phase is missing in assignment rows', () => {
    const collisions = detectMakerCheckerCollisionsFromAssignments([
      { expertId: 'e-2', focus: 'implement' },
      { expertId: 'e-2', focus: 'review' },
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.expertId).toBe('e-2');
  });

  it('skips rows with unclassifiable role signals', () => {
    expect(
      detectMakerCheckerCollisionsFromAssignments([
        { expertId: 'e-3', phase: 'implement' },
        { expertId: 'e-3', phase: 'unknown-phase' },
      ]),
    ).toEqual([]);
  });

  it('caps the colliding expert roster at 4 names with a +N suffix', () => {
    const collisions = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      expertId: id,
      expertName: `Expert ${id.toUpperCase()}`,
      makerPhase: 'implement',
      checkerPhase: 'review',
    }));
    const tip = formatMakerCheckerSoftWarn(collisions, { env: {} });
    expect(tip).toContain('Expert A, Expert B, Expert C, Expert D');
    expect(tip).toContain('+1 more');
  });
});
