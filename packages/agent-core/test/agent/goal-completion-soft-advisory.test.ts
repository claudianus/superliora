import { describe, expect, it } from 'vitest';

import {
  evaluateGoalCompletionSoftAdvisory,
  formatGoalCompletionSoftAdvisory,
} from '../../src/agent/goal/goal-completion-soft-advisory';
import type { UltraworkRun } from '@superliora/protocol';
import type { VerificationFailureRecord } from '../../src/sensors/verification-sensor-ledger';

function baseRun(overrides: Partial<UltraworkRun> = {}): UltraworkRun {
  return {
    id: 'run-1',
    objective: 'ship',
    stage: 'implement',
    status: 'running',
    ...overrides,
  } as UltraworkRun;
}

describe('evaluateGoalCompletionSoftAdvisory', () => {
  it('returns plain-goal soft tips when no ultrawork run is bound', () => {
    const advisory = evaluateGoalCompletionSoftAdvisory({ ultraworkRun: null });
    expect(advisory).not.toBeNull();
    expect(advisory?.tips.join('\n')).toContain('plain Goal completed without WorkGraph evidence gate');
    expect(advisory?.tips.join('\n')).toContain('RunProjectChecks');
  });

  it('returns null for live ultrawork runs (hard gate owns rejection)', () => {
    expect(
      evaluateGoalCompletionSoftAdvisory({
        ultraworkRun: baseRun({ status: 'running', workGraph: { id: 'g', runId: 'run-1', nodes: [] } }),
      }),
    ).toBeNull();
  });

  it('returns null when structured GoalPredicate already enforces evidence', () => {
    const criterion = '```goal-predicate\n{"version":1,"minEvidenceIds":2}\n```';
    expect(
      evaluateGoalCompletionSoftAdvisory({
        ultraworkRun: null,
        completionCriterion: criterion,
      }),
    ).toBeNull();
  });

  it('surfaces WorkGraph audit gaps on terminal runs without structured predicate', () => {
    const advisory = evaluateGoalCompletionSoftAdvisory({
      ultraworkRun: baseRun({
        status: 'done',
        workGraph: {
          id: 'g',
          runId: 'run-1',
          nodes: [
            {
              id: 'ac_1',
              title: 'tests green',
              status: 'done',
              kind: 'acceptance_criterion',
              requiredEvidence: ['RunProjectChecks'],
            },
          ],
        },
      }),
      completionCriterion: 'all tests pass',
    });
    expect(advisory).not.toBeNull();
    expect(advisory?.tips.join('\n')).toContain('evidence requirements');
    expect(advisory?.tips.join('\n')).toContain('RunProjectChecks');
  });

  it('returns null when terminal run WorkGraph passes audit', () => {
    expect(
      evaluateGoalCompletionSoftAdvisory({
        ultraworkRun: baseRun({
          status: 'done',
          workGraph: {
            id: 'g',
            runId: 'run-1',
            nodes: [
              {
                id: 'ac_1',
                title: 'tests green',
                status: 'done',
                kind: 'acceptance_criterion',
                requiredEvidence: ['RunProjectChecks'],
                evidenceIds: ['run-project-checks'],
                verificationStatus: 'passed',
              },
            ],
          },
        }),
      }),
    ).toBeNull();
  });

  it('appends soft tips when recent test failures exist even if evidence audit passed', () => {
    const failures: VerificationFailureRecord[] = [
      {
        toolName: 'RunProjectChecks',
        summary: 'Project checks failed: test.',
        recordedAtMs: Date.now(),
      },
    ];
    const advisory = evaluateGoalCompletionSoftAdvisory({
      ultraworkRun: baseRun({
        status: 'done',
        workGraph: {
          id: 'g',
          runId: 'run-1',
          nodes: [
            {
              id: 'ac_1',
              title: 'tests green',
              status: 'done',
              kind: 'acceptance_criterion',
              requiredEvidence: ['RunProjectChecks'],
              evidenceIds: ['run-project-checks'],
              verificationStatus: 'passed',
            },
          ],
        },
      }),
      recentVerificationFailures: failures,
    });
    expect(advisory).not.toBeNull();
    expect(advisory?.tips.join('\n')).toContain('recent test/command failure evidence');
    expect(advisory?.tips.join('\n')).toContain('RunProjectChecks');
  });

  it('merges failure tips with plain-goal soft tips', () => {
    const advisory = evaluateGoalCompletionSoftAdvisory({
      ultraworkRun: null,
      recentVerificationFailures: [
        {
          toolName: 'Bash',
          summary: 'pnpm test — 3 failed',
          recordedAtMs: Date.now(),
        },
      ],
    });
    expect(advisory?.tips.join('\n')).toContain('plain Goal completed without WorkGraph evidence gate');
    expect(advisory?.tips.join('\n')).toContain('recent test/command failure evidence');
  });
});

describe('formatGoalCompletionSoftAdvisory', () => {
  it('labels the message as non-blocking', () => {
    const text = formatGoalCompletionSoftAdvisory({ tips: ['RunProjectChecks before done.'] });
    expect(text).toContain('Advisory (soft — not blocking)');
    expect(text).toContain('- RunProjectChecks before done.');
  });
});
