import { describe, expect, it } from 'vitest';

import { questUrgencyScore, compareByUrgency } from '#/tui/controllers/quest-urgency';
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
