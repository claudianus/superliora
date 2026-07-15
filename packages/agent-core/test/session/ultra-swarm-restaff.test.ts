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

import {
  buildRestaffSpecs,
  buildInitialSpecs,
  shouldSkipAdaptiveRestaff,
  planPhaseWaveEntries,
  shouldPostImplementWaveStandup,
  selectRestaffPhaseSpecs,
} from '../../src/tools/builtin/collaboration/ultra-swarm-phase';
import { buildUltraSwarmExpertPrompt } from '../../src/tools/builtin/collaboration/ultra-swarm-prompt';
import type { ExpertAssignment } from '../../src/expert-agents/types';

describe('ultra-swarm restaff/prompt pure builders', () => {
  it('buildRestaffSpecs stamps phase/focus/work nodes', () => {
    const experts = [
      {
        expertId: 'security-reviewer',
        expertName: 'Security Reviewer',
        prompt: 'Review security.',
        emoji: '🛡',
        color: '#f00',
        coverageLane: 'security_privacy',
        division: 'security',
      },
    ] as ExpertAssignment[];
    const specs = buildRestaffSpecs({
      experts,
      startIndex: 3,
      phase: 'review',
      focus: 'full',
      runId: 'run-1',
      workNodeIds: ['n1', 'n2'],
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      index: 4,
      expertId: 'security-reviewer',
      phase: 'review',
      focus: 'full',
      runId: 'run-1',
      workNodeIds: ['n1', 'n2'],
      requiredForCompletion: true,
    });
  });

  it('buildUltraSwarmExpertPrompt includes verdict gate for review', () => {
    const prompt = buildUltraSwarmExpertPrompt({
      spec: {
        index: 1,
        expertId: 'security-reviewer',
        expertName: 'Security Reviewer',
        assignmentPrompt: 'Check auth.',
        phase: 'review',
        focus: 'review',
        emoji: '🛡',
        color: '#f00',
        runId: 'run-1',
        requiredForCompletion: true,
        workNodeIds: [],
      },
      taskDescription: 'Harden login',
      workNodes: [],
      phaseHandoff: '<handoff/>',
      team: {
        id: 'team-1',
        runId: 'run-1',
        intensity: 'balanced',
        maxExperts: 4,
        experts: [],
      },
      busEnabled: false,
    });
    expect(prompt).toContain('VERDICT: PASS');
    expect(prompt).toContain('Harden login');
    expect(prompt).toContain('Check auth.');
    expect(prompt).toContain('<previous_phase_handoff>');
  });

  it('buildInitialSpecs marks required and review experts as completion-critical', () => {
    const experts = [
      {
        expertId: 'impl',
        expertName: 'Implementer',
        prompt: 'Implement',
        emoji: '🔧',
        color: '#0f0',
        coverageLane: 'implementation_core',
      },
      {
        expertId: 'rev',
        expertName: 'Reviewer',
        prompt: 'Review',
        emoji: '✅',
        color: '#00f',
        coverageLane: 'testing_evidence',
      },
    ] as ExpertAssignment[];
    const specs = buildInitialSpecs({
      experts,
      focus: 'full',
      runId: 'run-2',
      workNodeIds: ['n1'],
      requiredExpertIds: new Set(['impl']),
    });
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({
      expertId: 'impl',
      phase: 'implement',
      requiredForCompletion: true,
      workNodeIds: ['n1'],
    });
    expect(specs[1]).toMatchObject({
      expertId: 'rev',
      phase: 'review',
      requiredForCompletion: true,
    });
  });

  it('shouldSkipAdaptiveRestaff honors steer pause and solid consensus', () => {
    expect(
      shouldSkipAdaptiveRestaff({
        pausedForSteer: true,
        decision: 'revise',
        intensity: 'heavy',
      }),
    ).toBe(true);
    expect(
      shouldSkipAdaptiveRestaff({
        pausedForSteer: false,
        decision: 'strong-approve',
        intensity: 'heavy',
      }),
    ).toBe(true);
    expect(
      shouldSkipAdaptiveRestaff({
        pausedForSteer: false,
        decision: 'approve',
        intensity: 'light',
      }),
    ).toBe(true);
    expect(
      shouldSkipAdaptiveRestaff({
        pausedForSteer: false,
        decision: 'approve',
        intensity: 'heavy',
      }),
    ).toBe(false);
  });

  it('planPhaseWaveEntries stamps swarm items and implement standup gate', () => {
    const specs = [
      {
        index: 1,
        expertId: 'a',
        expertName: 'A',
        assignmentPrompt: 'do',
        phase: 'implement' as const,
        focus: 'implement' as const,
        emoji: '1',
        color: '#111',
        runId: 'r',
        requiredForCompletion: false,
        workNodeIds: ['node-1'],
      },
      {
        index: 2,
        expertId: 'b',
        expertName: 'B',
        assignmentPrompt: 'do',
        phase: 'implement' as const,
        focus: 'implement' as const,
        emoji: '2',
        color: '#222',
        runId: 'r',
        requiredForCompletion: false,
        workNodeIds: [],
      },
    ];
    const planned = planPhaseWaveEntries(specs, [specs]);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.[0]?.swarmItem).toBe('node-1');
    expect(planned[0]?.[1]?.swarmItem).toBe('b');
    expect(planned[0]?.[0]?.descriptionSuffix).toContain('#1');
    expect(shouldPostImplementWaveStandup(true, 'implement')).toBe(true);
    expect(shouldPostImplementWaveStandup(true, 'review')).toBe(false);
    expect(shouldPostImplementWaveStandup(false, 'implement')).toBe(false);
  });

  it('selectRestaffPhaseSpecs only diversifies review phases', () => {
    const restaffSpecs = [
      {
        index: 9,
        expertId: 'rev-2',
        expertName: 'Reviewer 2',
        assignmentPrompt: 'review',
        phase: 'review' as const,
        focus: 'review' as const,
        emoji: 'r',
        color: '#333',
        runId: 'r',
        requiredForCompletion: true,
        workNodeIds: [],
      },
    ];
    const implement = selectRestaffPhaseSpecs({
      phase: 'implement',
      restaffSpecs: [{ ...restaffSpecs[0]!, phase: 'implement', focus: 'implement' }],
      priorRendered: [],
      intensity: 'heavy',
    });
    expect(implement[0]?.criticAssignment).toBeUndefined();
    // review path may attach or leave undefined depending on critic sources; ensure array returned
    const review = selectRestaffPhaseSpecs({
      phase: 'review',
      restaffSpecs,
      priorRendered: [],
      intensity: 'light',
    });
    expect(review).toHaveLength(1);
    expect(review[0]?.expertId).toBe('rev-2');
  });
});
