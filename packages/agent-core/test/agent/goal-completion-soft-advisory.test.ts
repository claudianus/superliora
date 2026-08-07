import { describe, expect, it } from 'vitest';

import {
  GOAL_FALSE_COMPLETE_CODE,
  GOAL_SOFT_ADVISORY_PREFIX,
  evaluateGoalCompletionSoftAdvisory,
  formatGoalCompletionSoftAdvisory,
  formatGoalFalseCompleteRejectTip,
} from '../../src/agent/goal/goal-completion-soft-advisory';
import type { VerificationFailureRecord } from '../../src/sensors/verification-sensor-ledger';

describe('evaluateGoalCompletionSoftAdvisory', () => {
  it('returns plain-goal soft tips when no structured predicate is bound', () => {
    const advisory = evaluateGoalCompletionSoftAdvisory({});
    expect(advisory).not.toBeNull();
    expect(advisory?.tips.join('\n')).toContain('plain Goal completed without WorkGraph evidence gate');
    expect(advisory?.tips.join('\n')).toContain('RunProjectChecks');
  });

  it('returns null when structured GoalPredicate already enforces evidence', () => {
    const criterion = '```goal-predicate\n{"version":1,"minEvidenceIds":2}\n```';
    expect(
      evaluateGoalCompletionSoftAdvisory({
        completionCriterion: criterion,
      }),
    ).toBeNull();
  });

  it('appends soft tips when recent test failures exist even under a structured predicate', () => {
    const failures: VerificationFailureRecord[] = [
      {
        toolName: 'RunProjectChecks',
        summary: 'Project checks failed: test.',
        recordedAtMs: Date.now(),
      },
    ];
    const advisory = evaluateGoalCompletionSoftAdvisory({
      completionCriterion: '```goal-predicate\n{"version":1,"minEvidenceIds":2}\n```',
      recentVerificationFailures: failures,
    });
    expect(advisory).not.toBeNull();
    expect(advisory?.tips.join('\n')).toContain('recent test/command failure evidence');
    expect(advisory?.tips.join('\n')).toContain('RunProjectChecks');
  });

  it('merges failure tips with plain-goal soft tips', () => {
    const advisory = evaluateGoalCompletionSoftAdvisory({
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

  it('appends mutation-pending soft tips when files were mutated without a later check', () => {
    const advisory = evaluateGoalCompletionSoftAdvisory({
      mutationVerificationLedger: {
        pending: [{ toolName: 'Edit', recordedAtMs: Date.now() }],
      },
    });
    expect(advisory?.tips.join('\n')).toContain('mutated this session without a subsequent green');
    expect(advisory?.tips.join('\n')).toContain('Edit');
  });

  // Loop21c: green auto-spawn window → mutation tips suppressed (plain goal tips remain).
  it('suppresses mutation tips when recentAutoCheckSpawnOk', () => {
    const advisory = evaluateGoalCompletionSoftAdvisory({
      mutationVerificationLedger: {
        pending: [{ toolName: 'Write', recordedAtMs: Date.now() }],
      },
      recentAutoCheckSpawnOk: true,
    });
    const text = advisory?.tips.join('\n') ?? '';
    expect(text).not.toContain('mutated this session without a subsequent green');
    expect(text).toContain('plain Goal completed without WorkGraph evidence gate');
  });
});

describe('formatGoalCompletionSoftAdvisory', () => {
  it('labels the message as non-blocking with Loop36a prefix', () => {
    const text = formatGoalCompletionSoftAdvisory({ tips: ['RunProjectChecks before done.'] });
    expect(text.startsWith(GOAL_SOFT_ADVISORY_PREFIX)).toBe(true);
    expect(text).toContain('Advisory (soft — not blocking)');
    expect(text).toContain('- RunProjectChecks before done.');
  });

  it('formats false-complete reject tip', () => {
    const tip = formatGoalFalseCompleteRejectTip('evidence_missing');
    expect(tip.startsWith(GOAL_FALSE_COMPLETE_CODE)).toBe(true);
    expect(tip).toContain('evidence_missing');
  });
});
