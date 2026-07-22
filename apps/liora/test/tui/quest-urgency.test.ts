import { describe, expect, it } from 'vitest';

import {
  questUrgencyScore,
  compareByUrgency,
  rankQuestsByUrgency,
  escalationLevelFor,
  escalatedUrgencyScore,
  rankQuestsByEscalatedUrgency,
  urgencyDistribution,
} from '#/tui/controllers/quest-urgency';
import {
  ATTENTION_ESCALATION_MS,
  ATTENTION_CRITICAL_MS,
} from '#/tui/controllers/attention-controller';
import type { Quest } from '#/tui/controllers/quest-types';

function makeQuest(id: string, overrides: Partial<Quest> = {}): Quest {
  return {
    id,
    name: `Quest ${id}`,
    sessionRef: `session-${id}`,
    state: 'running',
    createdAt: 1000,
    lastActivityAt: 1000,
    changeCount: { added: 0, removed: 0 },
    planStep: 'Working',
    worktreePath: `/tmp/wt/${id}`,
    pinned: false,
    approvalPending: false,
    ...overrides,
  };
}

describe('quest urgency scoring (Gen 38)', () => {
  it('attention states outrank healthy states regardless of dwell', () => {
    const now = 100_000;
    const approval = makeQuest('a', { state: 'waiting-approval', attentionEnteredAt: now });
    const running = makeQuest('b', { state: 'running' });
    expect(questUrgencyScore(approval, now)).toBeGreaterThan(questUrgencyScore(running, now));
  });

  it('failed outranks blocked, blocked outranks running', () => {
    const now = 100_000;
    const failed = makeQuest('a', { state: 'failed', attentionEnteredAt: now });
    const blocked = makeQuest('b', { state: 'blocked' });
    const running = makeQuest('c', { state: 'running' });
    expect(questUrgencyScore(failed, now)).toBeGreaterThan(questUrgencyScore(blocked, now));
    expect(questUrgencyScore(blocked, now)).toBeGreaterThan(questUrgencyScore(running, now));
  });

  it('within the same attention state, longer dwell wins', () => {
    const now = 100_000;
    const old = makeQuest('a', { state: 'waiting-approval', attentionEnteredAt: now - 60_000 });
    const recent = makeQuest('b', { state: 'waiting-approval', attentionEnteredAt: now - 1_000 });
    expect(questUrgencyScore(old, now)).toBeGreaterThan(questUrgencyScore(recent, now));
  });

  it('dwell only counts while in an attention state', () => {
    const now = 100_000;
    // A running quest with a stale attentionEnteredAt must not gain dwell weight.
    const running = makeQuest('a', { state: 'running', attentionEnteredAt: now - 60_000 });
    const runningFresh = makeQuest('b', { state: 'running' });
    expect(questUrgencyScore(running, now)).toBe(questUrgencyScore(runningFresh, now));
  });

  it('compareByUrgency sorts the most urgent first', () => {
    const now = 100_000;
    const quests = [
      makeQuest('running', { state: 'running' }),
      makeQuest('recent-approval', { state: 'waiting-approval', attentionEnteredAt: now - 1_000 }),
      makeQuest('old-approval', { state: 'waiting-approval', attentionEnteredAt: now - 60_000 }),
      makeQuest('failed', { state: 'failed', attentionEnteredAt: now - 5_000 }),
    ];
    const sorted = [...quests].sort((a, b) => compareByUrgency(a, b, now));
    // State priority dominates: both waiting-approval quests outrank failed,
    // and within waiting-approval the longer dwell sorts first.
    expect(sorted.map((q) => q.id)).toEqual([
      'old-approval',
      'recent-approval',
      'failed',
      'running',
    ]);
  });

  it('clamps negative dwell to zero', () => {
    const now = 100_000;
    const future = makeQuest('a', { state: 'waiting-approval', attentionEnteredAt: now + 5_000 });
    const fresh = makeQuest('b', { state: 'waiting-approval', attentionEnteredAt: now });
    expect(questUrgencyScore(future, now)).toBe(questUrgencyScore(fresh, now));
  });
});

describe('rankQuestsByUrgency (Gen 49)', () => {
  it('returns quests most urgent first with their scores', () => {
    const now = 100_000;
    const quests = [
      makeQuest('running', { state: 'running' }),
      makeQuest('approval', { state: 'waiting-approval', attentionEnteredAt: now - 5_000 }),
      makeQuest('failed', { state: 'failed', attentionEnteredAt: now }),
    ];
    const ranked = rankQuestsByUrgency(quests, now);
    expect(ranked.map((r) => r.quest.id)).toEqual(['approval', 'failed', 'running']);
    // Scores are attached and monotonically non-increasing.
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    expect(ranked[1]!.score).toBeGreaterThanOrEqual(ranked[2]!.score);
  });

  it('is stable for equal scores (preserves input order)', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { state: 'running' }),
      makeQuest('b', { state: 'running' }),
      makeQuest('c', { state: 'running' }),
    ];
    const ranked = rankQuestsByUrgency(quests, now);
    expect(ranked.map((r) => r.quest.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for no quests', () => {
    expect(rankQuestsByUrgency([], 100_000)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const now = 100_000;
    const quests = [
      makeQuest('running', { state: 'running' }),
      makeQuest('approval', { state: 'waiting-approval', attentionEnteredAt: now }),
    ];
    rankQuestsByUrgency(quests, now);
    expect(quests.map((q) => q.id)).toEqual(['running', 'approval']);
  });
});

describe('escalation-aware urgency (Gen 56)', () => {
  it('escalationLevelFor is 0 before the threshold', () => {
    const now = 100_000;
    const quest = makeQuest('a', {
      state: 'waiting-approval',
      attentionEnteredAt: now - (ATTENTION_ESCALATION_MS - 1),
    });
    expect(escalationLevelFor(quest, now)).toBe(0);
  });

  it('escalationLevelFor is 1 between the escalation and critical thresholds', () => {
    const now = 100_000;
    const quest = makeQuest('a', {
      state: 'waiting-approval',
      attentionEnteredAt: now - ATTENTION_ESCALATION_MS,
    });
    expect(escalationLevelFor(quest, now)).toBe(1);
  });

  it('escalationLevelFor is 2 once the critical threshold is reached', () => {
    const now = 100_000;
    const quest = makeQuest('a', {
      state: 'waiting-approval',
      attentionEnteredAt: now - ATTENTION_CRITICAL_MS,
    });
    expect(escalationLevelFor(quest, now)).toBe(2);
  });

  it('escalationLevelFor is 0 for a quest not in an attention state', () => {
    const now = 100_000;
    const quest = makeQuest('a', {
      state: 'running',
      attentionEnteredAt: now - ATTENTION_CRITICAL_MS,
    });
    expect(escalationLevelFor(quest, now)).toBe(0);
  });

  it('escalatedUrgencyScore adds a bonus per escalation level', () => {
    const now = 100_000;
    const escalated = makeQuest('a', {
      state: 'waiting-approval',
      attentionEnteredAt: now - ATTENTION_ESCALATION_MS,
    });
    const fresh = makeQuest('b', {
      state: 'waiting-approval',
      attentionEnteredAt: now - 1_000,
    });
    // The escalated quest gains a discrete bonus on top of its base score.
    expect(escalatedUrgencyScore(escalated, now)).toBeGreaterThan(
      escalatedUrgencyScore(fresh, now),
    );
    // A critical quest scores higher than a warning-level one with the same
    // base urgency.
    const critical = makeQuest('c', {
      state: 'waiting-approval',
      attentionEnteredAt: now - ATTENTION_CRITICAL_MS,
    });
    expect(escalatedUrgencyScore(critical, now)).toBeGreaterThan(
      escalatedUrgencyScore(escalated, now),
    );
  });

  it('escalatedUrgencyScore equals the base score when not escalated', () => {
    const now = 100_000;
    const quest = makeQuest('a', { state: 'running' });
    expect(escalatedUrgencyScore(quest, now)).toBe(questUrgencyScore(quest, now));
  });
});

describe('rankQuestsByEscalatedUrgency (Gen 57)', () => {
  it('surfaces an escalated quest ahead of a near-equal same-state quest', () => {
    const now = 100_000;
    // Both waiting-approval; the escalated one has waited just past the
    // threshold, the other slightly less — base urgency is close, but the
    // escalation bonus pushes the escalated quest to the front.
    const escalated = makeQuest('escalated', {
      state: 'waiting-approval',
      attentionEnteredAt: now - ATTENTION_ESCALATION_MS,
    });
    const nearEqual = makeQuest('near-equal', {
      state: 'waiting-approval',
      attentionEnteredAt: now - (ATTENTION_ESCALATION_MS - 10_000),
    });
    const ranked = rankQuestsByEscalatedUrgency([nearEqual, escalated], now);
    expect(ranked.map((r) => r.quest.id)).toEqual(['escalated', 'near-equal']);
  });

  it('attaches escalated scores, monotonically non-increasing', () => {
    const now = 100_000;
    const quests = [
      makeQuest('running', { state: 'running' }),
      makeQuest('critical', {
        state: 'waiting-approval',
        attentionEnteredAt: now - ATTENTION_CRITICAL_MS,
      }),
      makeQuest('warning', {
        state: 'waiting-approval',
        attentionEnteredAt: now - ATTENTION_ESCALATION_MS,
      }),
    ];
    const ranked = rankQuestsByEscalatedUrgency(quests, now);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    expect(ranked[1]!.score).toBeGreaterThanOrEqual(ranked[2]!.score);
  });

  it('is stable for equal scores (preserves input order)', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { state: 'running' }),
      makeQuest('b', { state: 'running' }),
    ];
    const ranked = rankQuestsByEscalatedUrgency(quests, now);
    expect(ranked.map((r) => r.quest.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array for no quests and does not mutate input', () => {
    expect(rankQuestsByEscalatedUrgency([], 100_000)).toEqual([]);
    const now = 100_000;
    const quests = [
      makeQuest('running', { state: 'running' }),
      makeQuest('approval', { state: 'waiting-approval', attentionEnteredAt: now }),
    ];
    rankQuestsByEscalatedUrgency(quests, now);
    expect(quests.map((q) => q.id)).toEqual(['running', 'approval']);
  });
});

describe('urgencyDistribution (Gen 85)', () => {
  it('is all zeros for an empty fleet', () => {
    expect(urgencyDistribution([], 100_000)).toEqual({ normal: 0, escalated: 0, critical: 0 });
  });

  it('ignores quests not in an attention state', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { state: 'running' }),
      makeQuest('b', { state: 'idle' }),
      makeQuest('c', { state: 'done' }),
    ];
    expect(urgencyDistribution(quests, now)).toEqual({ normal: 0, escalated: 0, critical: 0 });
  });

  it('counts fresh attention quests as normal', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { state: 'waiting-approval', attentionEnteredAt: now - 1_000 }),
      makeQuest('b', { state: 'failed', attentionEnteredAt: now - 1_000 }),
    ];
    expect(urgencyDistribution(quests, now)).toEqual({ normal: 2, escalated: 0, critical: 0 });
  });

  it('counts quests between the thresholds as escalated', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { state: 'waiting-approval', attentionEnteredAt: now - ATTENTION_ESCALATION_MS }),
      makeQuest('b', {
        state: 'failed',
        attentionEnteredAt: now - (ATTENTION_CRITICAL_MS - 1_000),
      }),
    ];
    expect(urgencyDistribution(quests, now)).toEqual({ normal: 0, escalated: 2, critical: 0 });
  });

  it('counts quests past the critical threshold as critical', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { state: 'waiting-approval', attentionEnteredAt: now - ATTENTION_CRITICAL_MS }),
    ];
    expect(urgencyDistribution(quests, now)).toEqual({ normal: 0, escalated: 0, critical: 1 });
  });

  it('spreads a mixed fleet across all three buckets', () => {
    const now = 100_000;
    const quests = [
      makeQuest('fresh', { state: 'waiting-approval', attentionEnteredAt: now - 1_000 }),
      makeQuest('warn', { state: 'waiting-approval', attentionEnteredAt: now - ATTENTION_ESCALATION_MS }),
      makeQuest('crit', { state: 'failed', attentionEnteredAt: now - ATTENTION_CRITICAL_MS }),
      makeQuest('running', { state: 'running' }),
    ];
    expect(urgencyDistribution(quests, now)).toEqual({ normal: 1, escalated: 1, critical: 1 });
  });
});
