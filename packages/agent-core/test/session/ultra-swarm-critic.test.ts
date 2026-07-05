import { describe, expect, it } from 'vitest';

import {
  assignReviewCriticEdges,
  buildCriticAssignmentXml,
} from '../../src/session/ultra-swarm-critic';

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
});
