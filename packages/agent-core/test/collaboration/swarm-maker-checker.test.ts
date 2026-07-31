import { describe, expect, it } from 'vitest';

import {
  classifySwarmLaneRole,
  classifySwarmPhaseRole,
  detectAgentSwarmItemRoleCollision,
  detectMakerCheckerCollisions,
  detectMakerCheckerCollisionsFromSwarmOutput,
  detectMakerCheckerCollisionsFromUltraSwarmResults,
  formatMakerCheckerSoftWarn,
  makerCheckerSoftWarnFromAgentSwarmItems,
  SWARM_MAKER_CHECKER_SOFT_TIP,
} from '#/fleet';

describe('swarm-maker-checker.ts — role classification', () => {
  it('maps UltraSwarm phases to maker vs checker', () => {
    expect(classifySwarmPhaseRole('implement')).toBe('maker');
    expect(classifySwarmPhaseRole('plan')).toBe('maker');
    expect(classifySwarmPhaseRole('review')).toBe('checker');
    expect(classifySwarmPhaseRole('review-revision')).toBe('checker');
  });

  it('maps coverage lanes using ultra-swarm heuristics', () => {
    expect(classifySwarmLaneRole('architecture_implementation')).toBe('maker');
    expect(classifySwarmLaneRole('testing_evidence')).toBe('checker');
    expect(classifySwarmLaneRole('security_privacy')).toBe('checker');
  });
});

describe('swarm-maker-checker.ts — expert collisions', () => {
  it('returns empty when experts stay maker-only or checker-only', () => {
    const results = detectMakerCheckerCollisionsFromUltraSwarmResults([
      {
        spec: {
          expertId: 'a',
          expertName: 'Alpha',
          phase: 'implement',
        },
      },
      {
        spec: {
          expertId: 'b',
          expertName: 'Bravo',
          phase: 'review',
        },
      },
    ]);
    expect(results).toEqual([]);
  });

  it('flags when the same expert both implements and reviews', () => {
    const results = detectMakerCheckerCollisionsFromUltraSwarmResults([
      {
        spec: {
          expertId: 'e-1',
          expertName: 'Solo Expert',
          phase: 'implement',
        },
      },
      {
        spec: {
          expertId: 'e-1',
          expertName: 'Solo Expert',
          phase: 'review',
        },
      },
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
      detectAgentSwarmItemRoleCollision([
        'Implement login route',
        'Review auth middleware for security gaps',
      ]),
    ).toBe(true);
  });

  it('does not warn when all items share one intent class', () => {
    expect(
      makerCheckerSoftWarnFromAgentSwarmItems(['Implement login route', 'Patch session store']),
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
