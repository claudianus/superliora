import { describe, expect, it } from 'vitest';

import {
  formatAttentionSummary,
  formatCostUsd,
  formatEscalationBadge,
  formatEscalationSummary,
  formatEscalatedAttentionSummary,
  formatEscalatedTriageLines,
  formatStripBlinkLabel,
  formatUrgencyRank,
} from '#/tui/controllers/quest-display';
import {
  type AttentionSummary,
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

describe('formatEscalationSummary (Gen 55)', () => {
  it('returns null when nothing is escalated', () => {
    expect(formatEscalationSummary([])).toBeNull();
    expect(formatEscalationSummary([0, 0, 0])).toBeNull();
  });

  it('reports the escalated count alone when none are critical', () => {
    expect(formatEscalationSummary([1, 1, 0])).toBe('2 escalated');
  });

  it('calls out the critical count separately', () => {
    expect(formatEscalationSummary([1, 2, 2, 0])).toBe('3 escalated (2 critical)');
  });

  it('reports a single critical quest', () => {
    expect(formatEscalationSummary([2])).toBe('1 escalated (1 critical)');
  });
});

describe('formatEscalatedTriageLines (Gen 58)', () => {
  it('ranks escalated quests first and appends their badge', () => {
    const now = 100_000;
    const quests = [
      makeQuest('fresh', { name: 'Fresh', state: 'waiting-approval', attentionEnteredAt: now - 1_000 }),
      makeQuest('critical', {
        name: 'Critical',
        state: 'waiting-approval',
        attentionEnteredAt: now - ATTENTION_CRITICAL_MS,
      }),
    ];
    const lines = formatEscalatedTriageLines(quests, 2, now);
    expect(lines).toEqual([
      '1. Critical [waiting-approval] 🔥 15m',
      '2. Fresh [waiting-approval]',
    ]);
  });

  it('omits the badge for quests below the escalation threshold', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { name: 'One', state: 'waiting-approval', attentionEnteredAt: now - 1_000 }),
    ];
    expect(formatEscalatedTriageLines(quests, 1, now)).toEqual(['1. One [waiting-approval]']);
  });

  it('shows a warning badge between the thresholds', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', {
        name: 'Warn',
        state: 'waiting-approval',
        attentionEnteredAt: now - ATTENTION_ESCALATION_MS,
      }),
    ];
    expect(formatEscalatedTriageLines(quests, 1, now)).toEqual(['1. Warn [waiting-approval] ⚠ 5m']);
  });

  it('returns an empty array for no quests or a non-positive topN', () => {
    const now = 100_000;
    const quests = [makeQuest('a', { state: 'running' })];
    expect(formatEscalatedTriageLines([], 3, now)).toEqual([]);
    expect(formatEscalatedTriageLines(quests, 0, now)).toEqual([]);
  });
});

describe('formatEscalatedAttentionSummary (Gen 59)', () => {
  it('returns null when nothing needs attention', () => {
    const summary: AttentionSummary = { count: 0, oldestQuestId: null, oldestDwellMs: null };
    expect(formatEscalatedAttentionSummary(summary, [])).toBeNull();
  });

  it('reports the oldest dwell and the critical count', () => {
    const summary: AttentionSummary = {
      count: 3,
      oldestQuestId: 'q1',
      oldestDwellMs: 120_000,
    };
    expect(formatEscalatedAttentionSummary(summary, [1, 2, 0])).toBe(
      '3 need attention (oldest 2m, 1 critical)',
    );
  });

  it('reports the escalated count when none are critical', () => {
    const summary: AttentionSummary = {
      count: 2,
      oldestQuestId: 'q1',
      oldestDwellMs: 300_000,
    };
    expect(formatEscalatedAttentionSummary(summary, [1, 1])).toBe(
      '2 need attention (oldest 5m, 2 escalated)',
    );
  });

  it('reports the oldest dwell alone when nothing is escalated', () => {
    const summary: AttentionSummary = {
      count: 1,
      oldestQuestId: 'q1',
      oldestDwellMs: 45_000,
    };
    expect(formatEscalatedAttentionSummary(summary, [0])).toBe('1 need attention (oldest 45s)');
  });

  it('reports the count alone when dwell is unknown and nothing is escalated', () => {
    const summary: AttentionSummary = { count: 1, oldestQuestId: 'q1', oldestDwellMs: null };
    expect(formatEscalatedAttentionSummary(summary, [0])).toBe('1 need attention');
  });
});

describe('formatStripBlinkLabel (Gen 61)', () => {
  it('returns null for level 0', () => {
    expect(formatStripBlinkLabel(0)).toBeNull();
  });

  it('formats a warning-level blink label', () => {
    expect(formatStripBlinkLabel(1)).toBe('⚡ BLINK');
  });

  it('formats a critical-level blink label', () => {
    expect(formatStripBlinkLabel(2)).toBe('🔥 BLINK');
  });
});

describe('formatCostUsd (Gen 62)', () => {
  it('returns null when the cost is undefined', () => {
    expect(formatCostUsd(undefined)).toBeNull();
  });

  it('returns null when the cost is zero or negative', () => {
    expect(formatCostUsd(0)).toBeNull();
    expect(formatCostUsd(-1)).toBeNull();
  });

  it('formats a positive cost to two decimals', () => {
    expect(formatCostUsd(1.234)).toBe('$1.23');
    expect(formatCostUsd(0.05)).toBe('$0.05');
    expect(formatCostUsd(12)).toBe('$12.00');
  });
});
