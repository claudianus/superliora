import { describe, expect, it } from 'vitest';

import { formatAttentionSummary, formatEscalationBadge, formatUrgencyRank } from '#/tui/controllers/quest-display';
import type { AttentionSummary } from '#/tui/controllers/attention-controller';
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

describe('formatAttentionSummary (Gen 50)', () => {
  it('returns null when nothing needs attention', () => {
    const summary: AttentionSummary = { count: 0, oldestQuestId: null, oldestDwellMs: null };
    expect(formatAttentionSummary(summary)).toBeNull();
  });

  it('formats count with the oldest dwell time', () => {
    const summary: AttentionSummary = {
      count: 3,
      oldestQuestId: 'q1',
      oldestDwellMs: 120_000, // 2 minutes
    };
    expect(formatAttentionSummary(summary)).toBe('3 need attention (oldest 2m)');
  });

  it('formats count alone when dwell is unknown', () => {
    const summary: AttentionSummary = { count: 1, oldestQuestId: 'q1', oldestDwellMs: null };
    expect(formatAttentionSummary(summary)).toBe('1 need attention');
  });

  it('formats sub-minute dwell in seconds', () => {
    const summary: AttentionSummary = {
      count: 2,
      oldestQuestId: 'q1',
      oldestDwellMs: 45_000,
    };
    expect(formatAttentionSummary(summary)).toBe('2 need attention (oldest 45s)');
  });
});

describe('formatUrgencyRank (Gen 50)', () => {
  it('returns the top-N most urgent quests, most urgent first', () => {
    const now = 100_000;
    const quests = [
      makeQuest('running', { name: 'Refactor', state: 'running' }),
      makeQuest('approval', { name: 'Fix login', state: 'waiting-approval', attentionEnteredAt: now - 5_000 }),
      makeQuest('failed', { name: 'Deploy', state: 'failed', attentionEnteredAt: now }),
    ];
    const lines = formatUrgencyRank(quests, 2, now);
    expect(lines).toEqual([
      '1. Fix login [waiting-approval]',
      '2. Deploy [failed]',
    ]);
  });

  it('returns all quests when topN exceeds the count', () => {
    const now = 100_000;
    const quests = [makeQuest('a', { name: 'One', state: 'running' })];
    expect(formatUrgencyRank(quests, 5, now)).toHaveLength(1);
  });

  it('returns an empty array for no quests', () => {
    expect(formatUrgencyRank([], 3, 100_000)).toEqual([]);
  });

  it('returns an empty array for a non-positive topN', () => {
    const quests = [makeQuest('a', { state: 'running' })];
    expect(formatUrgencyRank(quests, 0, 100_000)).toEqual([]);
  });
});

describe('formatEscalationBadge (Gen 54)', () => {
  it('returns null for level 0', () => {
    expect(formatEscalationBadge(0, 300_000)).toBeNull();
  });

  it('formats a warning badge with the dwell time', () => {
    expect(formatEscalationBadge(1, 300_000)).toBe('⚠ 5m');
  });

  it('formats a critical badge with the dwell time', () => {
    expect(formatEscalationBadge(2, 900_000)).toBe('🔥 15m');
  });

  it('omits the dwell time when it is unknown', () => {
    expect(formatEscalationBadge(1, null)).toBe('⚠');
    expect(formatEscalationBadge(2, null)).toBe('🔥');
  });

  it('formats sub-minute dwell in seconds', () => {
    expect(formatEscalationBadge(1, 45_000)).toBe('⚠ 45s');
  });
});
