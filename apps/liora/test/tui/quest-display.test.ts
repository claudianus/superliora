import { describe, expect, it } from 'vitest';

import {
  formatAttentionSummary,
  formatContextUsage,
  formatCostUsd,
  formatEscalationBadge,
  formatEscalationSummary,
  formatEscalatedAttentionSummary,
  formatEscalatedTriageLines,
  formatFleetChangeSummary,
  formatFleetContextSummary,
  formatFleetHealthSummary,
  formatFleetModelSummary,
  formatFleetStateSummary,
  formatFleetTodoSummary,
  formatHealthLabel,
  formatStripBlinkLabel,
  formatTodoProgress,
  formatTotalCostUsd,
  formatUrgencyRank,
  classifyHealthSeverity,
  buildFleetSummarySnapshot,
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

describe('formatTotalCostUsd (Gen 63)', () => {
  it('returns null when there are no costs', () => {
    expect(formatTotalCostUsd([])).toBeNull();
  });

  it('returns null when all costs are undefined or zero', () => {
    expect(formatTotalCostUsd([undefined, 0, undefined])).toBeNull();
  });

  it('sums the costs and appends a total suffix', () => {
    expect(formatTotalCostUsd([1.234, 2.0, undefined])).toBe('$3.23 total');
    expect(formatTotalCostUsd([0.05, 0.05])).toBe('$0.10 total');
  });
});

describe('formatFleetStateSummary (Gen 64)', () => {
  it('returns null when there are no quests', () => {
    expect(formatFleetStateSummary([])).toBeNull();
  });

  it('summarizes a single quest without pluralization', () => {
    const quests = [makeQuest('a', { state: 'running' })];
    expect(formatFleetStateSummary(quests)).toBe('1 quest (1 running)');
  });

  it('counts quests per state, most urgent first', () => {
    const quests = [
      makeQuest('a', { state: 'running' }),
      makeQuest('b', { state: 'running' }),
      makeQuest('c', { state: 'waiting-approval' }),
      makeQuest('d', { state: 'done' }),
      makeQuest('e', { state: 'idle' }),
    ];
    expect(formatFleetStateSummary(quests)).toBe(
      '5 quests (1 approval · 2 running · 1 idle · 1 done)',
    );
  });

  it('omits zero-count categories', () => {
    const quests = [
      makeQuest('a', { state: 'failed' }),
      makeQuest('b', { state: 'failed' }),
    ];
    expect(formatFleetStateSummary(quests)).toBe('2 quests (2 failed)');
  });
});

describe('formatTodoProgress (Gen 65)', () => {
  it('returns null when the progress is undefined', () => {
    expect(formatTodoProgress(undefined)).toBeNull();
  });

  it('returns null when there are no items', () => {
    expect(formatTodoProgress({ done: 0, total: 0 })).toBeNull();
  });

  it('formats done over total', () => {
    expect(formatTodoProgress({ done: 3, total: 5 })).toBe('3/5');
    expect(formatTodoProgress({ done: 0, total: 4 })).toBe('0/4');
    expect(formatTodoProgress({ done: 7, total: 7 })).toBe('7/7');
  });
});

describe('formatContextUsage (Gen 66)', () => {
  it('returns null when the usage is undefined', () => {
    expect(formatContextUsage(undefined)).toBeNull();
  });

  it('returns null when the usage is zero or negative', () => {
    expect(formatContextUsage(0)).toBeNull();
    expect(formatContextUsage(-0.1)).toBeNull();
  });

  it('formats a fraction as a whole percent', () => {
    expect(formatContextUsage(0.62)).toBe('62%');
    expect(formatContextUsage(0.625)).toBe('63%');
    expect(formatContextUsage(1)).toBe('100%');
  });

  it('clamps out-of-range values', () => {
    expect(formatContextUsage(1.5)).toBe('100%');
    expect(formatContextUsage(0.001)).toBe('0%');
  });
});

describe('classifyHealthSeverity (Gen 67)', () => {
  it('classifies scores >= 70 as healthy', () => {
    expect(classifyHealthSeverity(100)).toBe('healthy');
    expect(classifyHealthSeverity(70)).toBe('healthy');
  });

  it('classifies scores 40–69 as warning', () => {
    expect(classifyHealthSeverity(69)).toBe('warning');
    expect(classifyHealthSeverity(40)).toBe('warning');
  });

  it('classifies scores < 40 as critical', () => {
    expect(classifyHealthSeverity(39)).toBe('critical');
    expect(classifyHealthSeverity(0)).toBe('critical');
  });
});

describe('formatHealthLabel (Gen 68)', () => {
  it('returns a structured label with score, severity, and text', () => {
    const now = 100_000;
    const quest = makeQuest('a', { state: 'running', lastActivityAt: now });
    const label = formatHealthLabel(quest, now);
    expect(label.score).toBeGreaterThanOrEqual(0);
    expect(label.score).toBeLessThanOrEqual(100);
    expect(label.severity).toBe(classifyHealthSeverity(label.score));
    expect(label.text).toBe(`♥ ${String(label.score)}`);
  });

  it('marks a long-idle quest as less healthy', () => {
    const now = 100_000;
    const fresh = makeQuest('fresh', { state: 'running', lastActivityAt: now });
    const stale = makeQuest('stale', {
      state: 'running',
      lastActivityAt: now - 30 * 60 * 1000, // 30 minutes idle
    });
    expect(formatHealthLabel(stale, now).score).toBeLessThan(formatHealthLabel(fresh, now).score);
  });
});

describe('formatFleetHealthSummary (Gen 69)', () => {
  it('returns null when there are no quests', () => {
    expect(formatFleetHealthSummary([], 100_000)).toBeNull();
  });

  it('averages the per-quest health scores', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', { state: 'running', lastActivityAt: now }),
      makeQuest('b', { state: 'running', lastActivityAt: now }),
    ];
    const summary = formatFleetHealthSummary(quests, now);
    expect(summary).not.toBeNull();
    // Both quests are fresh and running, so the average should be high.
    expect(summary).toMatch(/^avg ♥ \d+$/);
  });

  it('reflects a degraded fleet', () => {
    const now = 100_000;
    const fresh = [makeQuest('a', { state: 'running', lastActivityAt: now })];
    const stale = [
      makeQuest('a', { state: 'running', lastActivityAt: now - 30 * 60 * 1000 }),
    ];
    const freshAvg = Number(formatFleetHealthSummary(fresh, now)!.replace('avg ♥ ', ''));
    const staleAvg = Number(formatFleetHealthSummary(stale, now)!.replace('avg ♥ ', ''));
    expect(staleAvg).toBeLessThan(freshAvg);
  });
});

describe('formatFleetChangeSummary (Gen 70)', () => {
  it('returns null when there are no quests', () => {
    expect(formatFleetChangeSummary([])).toBeNull();
  });

  it('sums added and removed across quests', () => {
    const quests = [
      makeQuest('a', { changeCount: { added: 100, removed: 20 } }),
      makeQuest('b', { changeCount: { added: 20, removed: 14 } }),
    ];
    expect(formatFleetChangeSummary(quests)).toBe('+120 −34');
  });

  it('handles quests with no changes', () => {
    const quests = [
      makeQuest('a', { changeCount: { added: 0, removed: 0 } }),
      makeQuest('b', { changeCount: { added: 5, removed: 0 } }),
    ];
    expect(formatFleetChangeSummary(quests)).toBe('+5 −0');
  });
});

describe('formatFleetTodoSummary (Gen 71)', () => {
  it('returns null when no quest reports todo items', () => {
    const quests = [makeQuest('a', { state: 'running' })];
    expect(formatFleetTodoSummary(quests)).toBeNull();
    expect(formatFleetTodoSummary([])).toBeNull();
  });

  it('sums done and total across quests with todo progress', () => {
    const quests = [
      makeQuest('a', { todoProgress: { done: 3, total: 5 } }),
      makeQuest('b', { todoProgress: { done: 9, total: 15 } }),
      makeQuest('c', { state: 'running' }), // no todo progress
    ];
    expect(formatFleetTodoSummary(quests)).toBe('12/20 todos');
  });

  it('ignores quests with an empty todo list', () => {
    const quests = [
      makeQuest('a', { todoProgress: { done: 0, total: 0 } }),
      makeQuest('b', { todoProgress: { done: 2, total: 4 } }),
    ];
    expect(formatFleetTodoSummary(quests)).toBe('2/4 todos');
  });
});

describe('formatFleetContextSummary (Gen 72)', () => {
  it('returns null when no quest reports context usage', () => {
    const quests = [makeQuest('a', { state: 'running' })];
    expect(formatFleetContextSummary(quests)).toBeNull();
    expect(formatFleetContextSummary([])).toBeNull();
  });

  it('averages the context usage across reporting quests', () => {
    const quests = [
      makeQuest('a', { contextUsage: 0.4 }),
      makeQuest('b', { contextUsage: 0.6 }),
      makeQuest('c', { state: 'running' }), // no context usage
    ];
    expect(formatFleetContextSummary(quests)).toBe('avg ctx 50%');
  });

  it('clamps out-of-range usage before averaging', () => {
    const quests = [
      makeQuest('a', { contextUsage: 1.5 }),
      makeQuest('b', { contextUsage: 0.5 }),
    ];
    // (1.0 + 0.5) / 2 = 0.75 -> 75%
    expect(formatFleetContextSummary(quests)).toBe('avg ctx 75%');
  });

  it('ignores zero and negative usage', () => {
    const quests = [
      makeQuest('a', { contextUsage: 0 }),
      makeQuest('b', { contextUsage: -0.1 }),
      makeQuest('c', { contextUsage: 0.8 }),
    ];
    expect(formatFleetContextSummary(quests)).toBe('avg ctx 80%');
  });
});

describe('formatFleetModelSummary (Gen 73)', () => {
  it('returns null when no quest reports a model', () => {
    const quests = [makeQuest('a', { state: 'running' })];
    expect(formatFleetModelSummary(quests)).toBeNull();
    expect(formatFleetModelSummary([])).toBeNull();
  });

  it('counts quests per model, most-used first', () => {
    const quests = [
      makeQuest('a', { modelName: 'claude' }),
      makeQuest('b', { modelName: 'claude' }),
      makeQuest('c', { modelName: 'claude' }),
      makeQuest('d', { modelName: 'gpt' }),
    ];
    expect(formatFleetModelSummary(quests)).toBe('3 claude · 1 gpt');
  });

  it('breaks ties alphabetically', () => {
    const quests = [
      makeQuest('a', { modelName: 'gpt' }),
      makeQuest('b', { modelName: 'claude' }),
    ];
    expect(formatFleetModelSummary(quests)).toBe('1 claude · 1 gpt');
  });

  it('ignores quests without a model name', () => {
    const quests = [
      makeQuest('a', { modelName: 'claude' }),
      makeQuest('b', { modelName: '' }),
      makeQuest('c', { state: 'running' }),
    ];
    expect(formatFleetModelSummary(quests)).toBe('1 claude');
  });
});

describe('buildFleetSummarySnapshot (Gen 74)', () => {
  it('returns all-null segments and an empty list for no quests', () => {
    const snapshot = buildFleetSummarySnapshot([], 100_000);
    expect(snapshot.stateSummary).toBeNull();
    expect(snapshot.healthSummary).toBeNull();
    expect(snapshot.changeSummary).toBeNull();
    expect(snapshot.todoSummary).toBeNull();
    expect(snapshot.contextSummary).toBeNull();
    expect(snapshot.modelSummary).toBeNull();
    expect(snapshot.segments).toEqual([]);
  });

  it('collects only the non-null segments in display order', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', {
        state: 'running',
        lastActivityAt: now,
        changeCount: { added: 10, removed: 2 },
        modelName: 'claude',
      }),
    ];
    const snapshot = buildFleetSummarySnapshot(quests, now);
    // state, health, change, and model are present; todo and context are null.
    expect(snapshot.stateSummary).toBe('1 quest (1 running)');
    expect(snapshot.changeSummary).toBe('+10 −2');
    expect(snapshot.modelSummary).toBe('1 claude');
    expect(snapshot.todoSummary).toBeNull();
    expect(snapshot.contextSummary).toBeNull();
    // segments contains exactly the non-null ones, in display order.
    expect(snapshot.segments).toEqual([
      snapshot.stateSummary,
      snapshot.healthSummary,
      snapshot.changeSummary,
      snapshot.modelSummary,
    ]);
    expect(snapshot.segments.every((segment) => segment !== null)).toBe(true);
  });

  it('includes todo and context segments when reported', () => {
    const now = 100_000;
    const quests = [
      makeQuest('a', {
        state: 'running',
        lastActivityAt: now,
        todoProgress: { done: 2, total: 4 },
        contextUsage: 0.5,
      }),
    ];
    const snapshot = buildFleetSummarySnapshot(quests, now);
    expect(snapshot.todoSummary).toBe('2/4 todos');
    expect(snapshot.contextSummary).toBe('avg ctx 50%');
    expect(snapshot.segments).toContain('2/4 todos');
    expect(snapshot.segments).toContain('avg ctx 50%');
  });
});
