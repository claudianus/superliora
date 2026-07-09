import { describe, expect, it } from 'vitest';

import {
  assignDiverseCriticEdges,
  assignReviewCriticEdges,
  buildCriticAssignmentXml,
  CRITIC_LENSES,
} from '../../src/session/ultra-swarm-critic';
import {
  consensusFromDiverseVotes,
  extractLensVotes,
} from '../../src/session/ultra-swarm-consensus';

describe('ultra-swarm critic edges', () => {
  it('pairs review experts with implement and plan sources in order', () => {
    const assignments = assignReviewCriticEdges(
      [
        { expertId: 'security-appsec-engineer', expertName: 'AppSec Engineer' },
        { expertId: 'testing-evidence-collector', expertName: 'QA Collector' },
      ],
      [
        {
          expertId: 'impl-engineer',
          expertName: 'Impl Engineer',
          phase: 'implement',
          verdict: 'PASS',
          handoff: 'Implemented auth middleware.',
        },
        {
          expertId: 'product-manager',
          expertName: 'Product Manager',
          phase: 'plan',
          verdict: 'PASS',
          handoff: 'Defined acceptance criteria.',
        },
      ],
    );

    expect(assignments.get('security-appsec-engineer')).toMatchObject({
      targetExpertId: 'impl-engineer',
      targetPhase: 'implement',
    });
    expect(assignments.get('testing-evidence-collector')).toMatchObject({
      targetExpertId: 'product-manager',
      targetPhase: 'plan',
    });
  });

  it('renders critic assignment xml with target handoff', () => {
    const xml = buildCriticAssignmentXml({
      criticExpertId: 'security-appsec-engineer',
      targetExpertId: 'impl-engineer',
      targetExpertName: 'Impl Engineer',
      targetPhase: 'implement',
      targetVerdict: 'PASS',
      targetHandoff: 'Implemented auth middleware.',
    });

    expect(xml).toContain('<critic_assignment>');
    expect(xml).toContain('Impl Engineer');
    expect(xml).toContain('<target_handoff>');
    expect(xml).toContain('Implemented auth middleware.');
  });

  it('includes review lens in assignment xml when provided', () => {
    const xml = buildCriticAssignmentXml({
      criticExpertId: 'security-appsec-engineer',
      targetExpertId: 'impl-engineer',
      targetExpertName: 'Impl Engineer',
      targetPhase: 'implement',
      targetVerdict: 'PASS',
      targetHandoff: 'Implemented auth middleware.',
      lensId: 'adversarial',
      lensAngle: 'Adopt an adversarial stance.',
    });

    expect(xml).toContain('<review_lens id="adversarial">');
    expect(xml).toContain('adversarial stance');
  });

  it('assigns diverse lenses across reviewers for multi-lens review', () => {
    const assignments = assignDiverseCriticEdges(
      [
        { expertId: 'reviewer-a', expertName: 'Reviewer A' },
        { expertId: 'reviewer-b', expertName: 'Reviewer B' },
        { expertId: 'reviewer-c', expertName: 'Reviewer C' },
      ],
      [
        {
          expertId: 'impl-engineer',
          expertName: 'Impl Engineer',
          phase: 'implement',
          verdict: 'PASS',
          handoff: 'Implemented feature.',
        },
      ],
      CRITIC_LENSES,
    );

    expect(assignments.size).toBe(3);
    const lensIds = [...assignments.values()].map((a) => a.lensId).sort();
    expect(lensIds).toEqual(['adversarial', 'edge-case', 'spec-strict']);
  });
});

describe('ultra-swarm consensus', () => {
  it('returns approve for unanimous high-confidence PASS votes', () => {
    const decision = consensusFromDiverseVotes([
      {
        expertId: 'a',
        verdict: 'PASS',
        confidence: 0.9,
        rationale: 'All acceptance criteria met in file auth.ts line 12',
      },
      {
        expertId: 'b',
        verdict: 'PASS',
        confidence: 0.85,
        rationale: 'Tests cover the happy path and edge cases',
      },
    ]);
    expect(decision).toBe('strong-approve');
  });

  it('returns revise when a high-confidence FAIL cannot be outvoted 2:1', () => {
    // Safety guard: high-confidence FAIL forces at least revise unless PASS
    // outweighs block weight by 2x.
    const decision = consensusFromDiverseVotes([
      {
        expertId: 'a',
        verdict: 'FAIL',
        confidence: 0.95,
        rationale: 'Missing test for auth edge case in file login.ts line 40',
      },
      {
        expertId: 'b',
        verdict: 'PASS',
        confidence: 0.4,
        rationale: 'Looks fine',
      },
    ]);
    expect(decision).toBe('revise');
  });

  it('returns block when multiple FAIL votes outweigh PASS', () => {
    const decision = consensusFromDiverseVotes([
      {
        expertId: 'a',
        verdict: 'FAIL',
        confidence: 0.5,
        rationale: 'Broken path in file login.ts line 10',
      },
      {
        expertId: 'b',
        verdict: 'FAIL',
        confidence: 0.5,
        rationale: 'Missing test coverage for step 2',
      },
      {
        expertId: 'c',
        verdict: 'PASS',
        confidence: 0.3,
        rationale: 'ok',
      },
    ]);
    expect(decision).toBe('block');
  });

  it('extracts votes from completed review results only', () => {
    const votes = extractLensVotes([
      {
        spec: { expertId: 'r1', phase: 'review' },
        status: 'completed',
        verdict: 'PASS',
        result: 'Looks good with tests covering the file path',
      },
      {
        spec: { expertId: 'i1', phase: 'implement' },
        status: 'completed',
        verdict: 'PASS',
        result: 'done',
      },
      {
        spec: { expertId: 'r2', phase: 'review' },
        status: 'failed',
        verdict: 'FAIL',
        error: 'timeout',
      },
    ]);
    expect(votes).toHaveLength(1);
    expect(votes[0]?.expertId).toBe('r1');
    expect(votes[0]?.verdict).toBe('PASS');
  });
});
