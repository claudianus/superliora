import { describe, expect, it } from 'vitest';

import {
  buildRestaffReflectionPrompt,
  collectRestaffGaps,
  filterRestaffPlan,
  needsRestaffing,
  restaffPhaseForGaps,
  restaffSlotsAvailable,
} from '../../src/session/ultra-swarm-restaff';

describe('ultra-swarm restaff helpers', () => {
  it('collects required non-pass gaps from completed results', () => {
    const gaps = collectRestaffGaps([
      {
        spec: {
          expertId: 'testing-evidence-collector',
          expertName: 'QA Collector',
          phase: 'review',
          requiredForCompletion: true,
        },
        verdict: 'BLOCKED',
        status: 'completed',
        result: 'VERDICT: BLOCKED missing tests',
      },
      {
        spec: {
          expertId: 'product-manager',
          expertName: 'Product Manager',
          phase: 'plan',
          requiredForCompletion: true,
        },
        verdict: 'PASS',
        status: 'completed',
        result: 'VERDICT: PASS',
      },
    ]);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      expertId: 'testing-evidence-collector',
      verdict: 'BLOCKED',
    });
  });

  it('needs restaffing when gaps remain and slots are available', () => {
    const gaps = collectRestaffGaps([
      {
        spec: {
          expertId: 'testing-evidence-collector',
          expertName: 'QA Collector',
          phase: 'review',
          requiredForCompletion: true,
        },
        verdict: 'BLOCKED',
        status: 'completed',
        result: 'VERDICT: BLOCKED',
      },
    ]);

    expect(needsRestaffing(gaps, 3, 5)).toBe(true);
    expect(needsRestaffing(gaps, 5, 5)).toBe(false);
    expect(restaffSlotsAvailable(3, 5)).toBe(2);
  });

  it('filters duplicate experts and caps restaff slots', () => {
    const plan = filterRestaffPlan(
      {
        taskDescription: 'task',
        strategy: 'parallel',
        experts: [
          {
            expertId: 'testing-evidence-collector',
            expertName: 'QA Collector',
            prompt: 'Review tests.',
          },
          {
            expertId: 'security-appsec-engineer',
            expertName: 'AppSec Engineer',
            prompt: 'Review security.',
          },
        ],
      },
      ['testing-evidence-collector'],
      2,
    );

    expect(plan.experts).toHaveLength(1);
    expect(plan.experts[0]?.expertId).toBe('security-appsec-engineer');
  });

  it('builds reflection prompt with gaps and digest', () => {
    const prompt = buildRestaffReflectionPrompt(
      'Ship auth middleware',
      [
        {
          expertId: 'testing-evidence-collector',
          expertName: 'QA Collector',
          phase: 'review',
          verdict: 'BLOCKED',
          summary: 'Missing integration tests.',
        },
      ],
      'digest line',
    );

    expect(prompt).toContain('Ship auth middleware');
    expect(prompt).toContain('QA Collector');
    expect(prompt).toContain('digest line');
  });

  it('chooses implement restaff when implement gaps exist', () => {
    expect(
      restaffPhaseForGaps([
        {
          expertId: 'engineering-software-architect',
          expertName: 'Architect',
          phase: 'implement',
          verdict: 'BLOCKED',
          summary: 'Incomplete design.',
        },
      ]),
    ).toBe('implement');
    expect(
      restaffPhaseForGaps([
        {
          expertId: 'testing-evidence-collector',
          expertName: 'QA Collector',
          phase: 'review',
          verdict: 'BLOCKED',
          summary: 'Missing tests.',
        },
      ]),
    ).toBe('review');
  });
});
