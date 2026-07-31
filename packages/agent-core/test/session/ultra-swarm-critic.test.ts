import type { TeamPlan } from '@superliora/protocol';
import { describe, expect, it } from 'vitest';

import { buildTeamRosterXml, buildSwarmChannelRulesXml, buildSwarmCollaborationRequiredXml } from '#/fleet';
import {
  assignDiverseCriticEdges,
  buildCriticAssignmentXml,
  type CriticAssignment,
  type CriticLens,
  type CriticReviewSource,
} from '../../src/session/ultra-swarm-critic';

const SAMPLE_TEAM: TeamPlan = {
  experts: [
    { id: 'e-1', name: 'Alpha', role: 'implementer', focus: 'core logic' },
    { id: 'e-2', name: 'Bravo', role: 'reviewer', focus: 'review', coverageLane: 'qa' },
  ],
};

describe('ultra-swarm-critic.ts — buildCriticAssignmentXml', () => {
  it('renders the critic edge prompt with explicit fields', () => {
    const a: CriticAssignment = {
      criticExpertId: 'rev-1',
      targetExpertId: 'e-1',
      targetExpertName: 'Alpha',
      targetPhase: 'implement',
      targetVerdict: 'PASS',
      targetHandoff: 'h body',
    };
    const out = buildCriticAssignmentXml(a);
    expect(out).toContain('<critic_assignment>');
    expect(out).toContain('Review as a critic edge for Alpha (e-1) in implement phase.');
    expect(out).toContain('Prior verdict: PASS.');
    expect(out).toContain('<target_handoff>');
    expect(out).toContain('h body');
    expect(out).toContain('</target_handoff>');
    expect(out).toContain('</critic_assignment>');
    expect(out).not.toContain('<review_lens');
  });

  it('emits a <review_lens> block when both lensId and lensAngle are provided', () => {
    const a: CriticAssignment = {
      criticExpertId: 'rev-1',
      targetExpertId: 'e-1',
      targetExpertName: 'Alpha',
      targetPhase: 'review',
      targetVerdict: 'REVISE',
      targetHandoff: 'h',
      lensId: 'safety',
      lensAngle: 'audit the user-visible side effects',
    };
    const out = buildCriticAssignmentXml(a);
    expect(out).toContain('<review_lens id="safety">audit the user-visible side effects</review_lens>');
  });
});

describe('ultra-swarm-critic.ts — assignDiverseCriticEdges', () => {
  const LENSES: CriticLens[] = [
    { lensId: 'safety', personaAngle: 'audit safety' },
    { lensId: 'clarity', personaAngle: 'audit clarity' },
  ];
  const REVIEWERS = [
    { expertId: 'r-1', expertName: 'Reviewer 1' },
    { expertId: 'r-2', expertName: 'Reviewer 2' },
    { expertId: 'r-3', expertName: 'Reviewer 3' },
    { expertId: 'r-4', expertName: 'Reviewer 4' },
  ];

  it('returns an empty map when reviewers, sources, or lenses are empty', () => {
    expect(assignDiverseCriticEdges([], [{ expertId: 's', expertName: 'S', phase: 'plan', verdict: 'PASS', handoff: 'h' }], LENSES).size).toBe(0);
    expect(assignDiverseCriticEdges(REVIEWERS, [], LENSES).size).toBe(0);
    expect(assignDiverseCriticEdges(REVIEWERS, [{ expertId: 's', expertName: 'S', phase: 'plan', verdict: 'PASS', handoff: 'h' }], []).size).toBe(0);
  });

  it('prioritizes implement/plan targets before review-only targets', () => {
    const sources: CriticReviewSource[] = [
      { expertId: 'rev-src', expertName: 'RevSrc', phase: 'review', verdict: 'PASS', handoff: 'rh' },
      { expertId: 'impl-src', expertName: 'ImplSrc', phase: 'implement', verdict: 'PASS', handoff: 'ih' },
      { expertId: 'plan-src', expertName: 'PlanSrc', phase: 'plan', verdict: 'PASS', handoff: 'ph' },
    ];
    const out = assignDiverseCriticEdges(REVIEWERS, sources, [LENSES[0]!]);
    // First assignment must point to the implement source (highest priority).
    const firstKey = out.keys().next().value as string;
    const first = out.get(firstKey);
    expect(first?.targetExpertId).toBe('impl-src');
  });

  it('cycles reviewers across lens×target so each reviewer is used at most once', () => {
    const sources: CriticReviewSource[] = [
      { expertId: 's-1', expertName: 'S1', phase: 'implement', verdict: 'PASS', handoff: 'h1' },
      { expertId: 's-2', expertName: 'S2', phase: 'implement', verdict: 'PASS', handoff: 'h2' },
    ];
    const out = assignDiverseCriticEdges(REVIEWERS.slice(0, 2), sources, LENSES);
    // lens×target = 2×2 = 4 attempts, but each reviewer can only be
    // assigned once (same-key skip), so the map caps at 2 entries.
    expect(out.size).toBe(2);
    const criticIds = [...out.values()].map((v) => v.criticExpertId);
    expect(new Set(criticIds).size).toBe(2);
  });

  it('attaches the lens metadata to each assignment', () => {
    const out = assignDiverseCriticEdges(
      [{ expertId: 'r-1', expertName: 'R1' }],
      [{ expertId: 's-1', expertName: 'S1', phase: 'plan', verdict: 'PASS', handoff: 'h' }],
      [LENSES[1]!],
    );
    const a = out.get('r-1');
    expect(a?.lensId).toBe('clarity');
    expect(a?.lensAngle).toBe('audit clarity');
  });
});

describe('swarm-bus-coordination.ts — XML builders', () => {
  it('buildTeamRosterXml uses coverageLane when provided and falls back to role', () => {
    const out = buildTeamRosterXml(SAMPLE_TEAM);
    expect(out).toContain('<team_roster>');
    expect(out).toContain('- Alpha (e-1) · implementer · focus=core logic');
    expect(out).toContain('- Bravo (e-2) · qa · focus=review');
    expect(out).toContain('</team_roster>');
  });

  it('buildTeamRosterXml returns the wrap with no bullets for an empty team', () => {
    const out = buildTeamRosterXml({ experts: [] });
    expect(out).toBe('<team_roster>\n</team_roster>');
  });

  it('buildSwarmChannelRulesXml pins the documented channel rule list', () => {
    const out = buildSwarmChannelRulesXml();
    expect(out).toContain('<swarm_channel_rules>');
    expect(out).toContain('Channels: standup (progress), lane (lane work), direct (@peer), blocker (urgent), council (review notes).');
    expect(out).toContain('</swarm_channel_rules>');
  });

  it('buildSwarmCollaborationRequiredXml switches on the phase', () => {
    const implement = buildSwarmCollaborationRequiredXml('implement');
    expect(implement).toContain('1. SwarmChannel list — read peer updates before major decisions.');
    expect(implement).toContain('3. Before handoff: SwarmChannel standup — outcome, evidence, open gaps.');

    const review = buildSwarmCollaborationRequiredXml('review');
    expect(review).toContain('1. Read upstream handoffs and SwarmChannel list before issuing VERDICT.');
    expect(review).not.toContain('Before handoff');

    const plan = buildSwarmCollaborationRequiredXml('plan');
    expect(plan).toContain('1. SwarmChannel standup when your plan findings affect implement or review lanes.');
    expect(plan).toContain('</collaboration_required>');
  });
});
