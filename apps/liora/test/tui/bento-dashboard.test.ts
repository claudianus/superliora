import { describe, expect, it } from 'vitest';

import { QuestGridController } from '#/tui/controllers/quest-grid-controller';
import { renderContextBar, renderTodoBar, renderChangeCount, renderHealthScore, spinnerFrame, actionHintBar, idleSeverityToken } from '#/tui/components/panes/bento-dashboard';
import { highlightStreamLine } from '#/tui/components/panes/quest-expand-view';
import { buildThumbnailStrip, renderThumbnailStripLine } from '#/tui/components/panes/thumbnail-strip';
import type { Quest } from '#/tui/controllers/quest-types';

function makeQuest(id: string, overrides: Partial<Quest> = {}): Quest {
  return {
    id,
    name: `Quest ${id}`,
    sessionRef: `session-${id}`,
    state: 'running',
    createdAt: Date.now() - 60_000,
    lastActivityAt: Date.now(),
    changeCount: { added: 3, removed: 1 },
    planStep: 'Implementing feature',
    worktreePath: `/tmp/worktrees/${id}`,
    pinned: false,
    approvalPending: false,
    ...overrides,
  };
}

function makeController(width = 120, height = 40) {
  return new QuestGridController({
    getViewport: () => ({ x: 0, y: 0, width, height }),
    requestRender: () => {},
  });
}

describe('bento-dashboard bounds validation (AC-1)', () => {
  it('3 quests: all cells within viewport bounds', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a'));
    ctrl.addQuest(makeQuest('b'));
    ctrl.addQuest(makeQuest('c'));

    const viewport = { x: 0, y: 0, width: 120, height: 40 };
    expect(ctrl.validateBounds(viewport)).toBe(true);
    expect(ctrl.questCount).toBe(3);
  });

  it('12 quests: all cells within viewport bounds', () => {
    const ctrl = makeController();
    for (let i = 0; i < 12; i++) {
      ctrl.addQuest(makeQuest(`q${i}`));
    }

    const viewport = { x: 0, y: 0, width: 120, height: 40 };
    expect(ctrl.validateBounds(viewport)).toBe(true);
    expect(ctrl.questCount).toBe(12);
  });

  it('narrow terminal (80x24): cells still within bounds', () => {
    const ctrl = makeController(80, 24);
    for (let i = 0; i < 6; i++) {
      ctrl.addQuest(makeQuest(`q${i}`));
    }

    const viewport = { x: 0, y: 0, width: 80, height: 24 };
    expect(ctrl.validateBounds(viewport)).toBe(true);
  });

  it('pinned mode: pinned cell gets larger span, still within bounds', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a'));
    ctrl.addQuest(makeQuest('b'));
    ctrl.addQuest(makeQuest('c'));
    ctrl.togglePin('a');

    const viewport = { x: 0, y: 0, width: 120, height: 40 };
    expect(ctrl.validateBounds(viewport)).toBe(true);
    expect(ctrl.getViewMode()).toBe('pinned');
  });

  it('removing a quest recomputes layout without bounds violation', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a'));
    ctrl.addQuest(makeQuest('b'));
    ctrl.addQuest(makeQuest('c'));
    ctrl.removeQuest('b');

    const viewport = { x: 0, y: 0, width: 120, height: 40 };
    expect(ctrl.validateBounds(viewport)).toBe(true);
    expect(ctrl.questCount).toBe(2);
  });

  it('getQuestCellBounds returns valid bounds for existing quest', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a'));
    ctrl.addQuest(makeQuest('b'));

    const bounds = ctrl.getQuestCellBounds('a');
    expect(bounds).not.toBeNull();
    expect(bounds!.colSpan).toBeGreaterThanOrEqual(1);
    expect(bounds!.rowSpan).toBeGreaterThanOrEqual(1);
  });

  it('getQuestCellBounds returns null for unknown quest', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a'));
    expect(ctrl.getQuestCellBounds('nonexistent')).toBeNull();
  });
});

describe('Gen 17: attention-first quest ordering', () => {
  it('getQuests sorts attention states to the top, stable within priority', () => {
    const ctrl = makeController();
    // Insert in a mixed order.
    ctrl.addQuest(makeQuest('running1', { state: 'running' }));
    ctrl.addQuest(makeQuest('failed1', { state: 'failed' }));
    ctrl.addQuest(makeQuest('idle1', { state: 'idle' }));
    ctrl.addQuest(makeQuest('approval1', { state: 'waiting-approval' }));
    ctrl.addQuest(makeQuest('done1', { state: 'done' }));
    ctrl.addQuest(makeQuest('approval2', { state: 'waiting-approval' }));

    const ids = ctrl.getQuests().map((q) => q.id);
    // waiting-approval first (insertion order), then failed, running, idle, done.
    expect(ids).toEqual([
      'approval1',
      'approval2',
      'failed1',
      'running1',
      'idle1',
      'done1',
    ]);
  });

  it('focus navigation follows the priority order', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('running1', { state: 'running' }));
    ctrl.addQuest(makeQuest('approval1', { state: 'waiting-approval' }));
    ctrl.addQuest(makeQuest('idle1', { state: 'idle' }));

    // First focusNext lands on the top-priority quest.
    ctrl.focusNext();
    expect(ctrl.getFocusedQuestId()).toBe('approval1');
    ctrl.focusNext();
    expect(ctrl.getFocusedQuestId()).toBe('running1');
    ctrl.focusNext();
    expect(ctrl.getFocusedQuestId()).toBe('idle1');
    // Wraps back to top.
    ctrl.focusNext();
    expect(ctrl.getFocusedQuestId()).toBe('approval1');
  });

  it('re-sorting happens when a quest changes into an attention state', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'running' }));
    ctrl.addQuest(makeQuest('c', { state: 'running' }));

    // Initially insertion order.
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['a', 'b', 'c']);

    // c needs approval → jumps to the top.
    ctrl.updateQuestState('c', 'waiting-approval');
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('Gen 24: dashboard quest filtering', () => {
  it('filters quests by name substring (case-insensitive)', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { name: 'Refactor auth' }));
    ctrl.addQuest(makeQuest('b', { name: 'Fix login bug' }));
    ctrl.addQuest(makeQuest('c', { name: 'AUTH tests' }));

    ctrl.setFilter('auth');
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['a', 'c']);
  });

  it('filters quests by state', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'failed' }));
    ctrl.addQuest(makeQuest('c', { state: 'running' }));

    ctrl.setFilter('failed');
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['b']);
  });

  it('empty filter shows all quests', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a'));
    ctrl.addQuest(makeQuest('b'));

    ctrl.setFilter('zzz');
    expect(ctrl.getQuests()).toHaveLength(0);

    ctrl.setFilter('');
    expect(ctrl.getQuests()).toHaveLength(2);
  });

  it('focus navigation stays within the filtered set', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { name: 'alpha' }));
    ctrl.addQuest(makeQuest('b', { name: 'beta' }));
    ctrl.addQuest(makeQuest('c', { name: 'alpha-two' }));

    ctrl.setFilter('alpha');
    ctrl.focusNext();
    expect(ctrl.getFocusedQuestId()).toBe('a');
    ctrl.focusNext();
    expect(ctrl.getFocusedQuestId()).toBe('c');
    // Wraps within the filtered set.
    ctrl.focusNext();
    expect(ctrl.getFocusedQuestId()).toBe('a');
  });

  it('getFilter returns the active query', () => {
    const ctrl = makeController();
    expect(ctrl.getFilter()).toBe('');
    ctrl.setFilter('fix');
    expect(ctrl.getFilter()).toBe('fix');
  });
});

describe('Gen 25: jump to next attention quest (Tab)', () => {
  it('cycles focus only through attention states', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'waiting-approval' }));
    ctrl.addQuest(makeQuest('c', { state: 'running' }));
    ctrl.addQuest(makeQuest('d', { state: 'failed' }));

    // First Tab lands on the first attention quest (priority order).
    ctrl.focusNextAttention();
    expect(ctrl.getFocusedQuestId()).toBe('b');
    ctrl.focusNextAttention();
    expect(ctrl.getFocusedQuestId()).toBe('d');
    // Wraps back to the first attention quest, skipping running ones.
    ctrl.focusNextAttention();
    expect(ctrl.getFocusedQuestId()).toBe('b');
  });

  it('is a no-op when no quest needs attention', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'idle' }));

    ctrl.focusNextAttention();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });

  it('resumes from the currently focused quest if it needs attention', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'failed' }));
    ctrl.addQuest(makeQuest('b', { state: 'waiting-approval' }));
    ctrl.addQuest(makeQuest('c', { state: 'failed' }));

    // Priority order of attention quests: b (waiting-approval), a, c (failed).
    ctrl.setFocusedQuest('a');
    ctrl.focusNextAttention();
    expect(ctrl.getFocusedQuestId()).toBe('c');
  });
});

describe('Gen 26: attention-only toggle', () => {
  it('shows only attention quests when enabled', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'waiting-approval' }));
    ctrl.addQuest(makeQuest('c', { state: 'failed' }));
    ctrl.addQuest(makeQuest('d', { state: 'idle' }));

    expect(ctrl.isAttentionOnly()).toBe(false);
    ctrl.toggleAttentionOnly();
    expect(ctrl.isAttentionOnly()).toBe(true);
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['b', 'c']);
  });

  it('toggles back to show all quests', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'failed' }));

    ctrl.toggleAttentionOnly();
    expect(ctrl.getQuests()).toHaveLength(1);
    ctrl.toggleAttentionOnly();
    expect(ctrl.getQuests()).toHaveLength(2);
  });

  it('combines with the text filter', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('auth-bug', { state: 'failed' }));
    ctrl.addQuest(makeQuest('login-fix', { state: 'failed' }));
    ctrl.addQuest(makeQuest('auth-tests', { state: 'running' }));

    ctrl.toggleAttentionOnly();
    ctrl.setFilter('auth');
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['auth-bug']);
  });
});

describe('Gen 75: context-risk-only toggle', () => {
  it('shows only quests at/above the 80% context threshold when enabled', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('low', { contextUsage: 0.2 }));
    ctrl.addQuest(makeQuest('warn', { contextUsage: 0.85 }));
    ctrl.addQuest(makeQuest('critical', { contextUsage: 0.97 }));
    ctrl.addQuest(makeQuest('unknown', {}));

    expect(ctrl.isCtxRiskOnly()).toBe(false);
    ctrl.toggleCtxRiskOnly();
    expect(ctrl.isCtxRiskOnly()).toBe(true);
    // Only the two quests at/above 80% remain; unknown usage is hidden.
    expect(ctrl.getQuests().map((q) => q.id).sort()).toEqual(['critical', 'warn']);
  });

  it('toggles back to show all quests', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('low', { contextUsage: 0.2 }));
    ctrl.addQuest(makeQuest('warn', { contextUsage: 0.9 }));

    ctrl.toggleCtxRiskOnly();
    expect(ctrl.getQuests()).toHaveLength(1);
    ctrl.toggleCtxRiskOnly();
    expect(ctrl.getQuests()).toHaveLength(2);
  });

  it('combines with the text filter', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('auth-hot', { contextUsage: 0.9 }));
    ctrl.addQuest(makeQuest('login-hot', { contextUsage: 0.95 }));
    ctrl.addQuest(makeQuest('auth-cool', { contextUsage: 0.3 }));

    ctrl.toggleCtxRiskOnly();
    ctrl.setFilter('auth');
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['auth-hot']);
  });
});

describe('Gen 55: focus weakest-health quest', () => {
  it('focuses the least-healthy quest', () => {
    const ctrl = makeController();
    // Health: failed (10) < blocked (45) < running (90).
    ctrl.addQuest(makeQuest('healthy', { state: 'running' }));
    ctrl.addQuest(makeQuest('critical', { state: 'failed' }));
    ctrl.addQuest(makeQuest('shaky', { state: 'blocked' }));

    ctrl.focusWeakestHealth();
    expect(ctrl.getFocusedQuestId()).toBe('critical');
  });

  it('is a no-op when no quest is visible', () => {
    const ctrl = makeController();
    ctrl.focusWeakestHealth();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 58: focus first/last quest', () => {
  it('focusFirst jumps to the first quest in sort order', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'failed' }));
    ctrl.addQuest(makeQuest('c', { state: 'idle' }));
    // Attention sort puts failed first: b, then a/c by insertion.
    ctrl.setFocusedQuest('c');
    ctrl.focusFirst();
    expect(ctrl.getFocusedQuestId()).toBe('b');
  });

  it('focusLast jumps to the last quest in sort order', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'failed' }));
    ctrl.addQuest(makeQuest('c', { state: 'idle' }));
    ctrl.setFocusedQuest('b');
    ctrl.focusLast();
    expect(ctrl.getFocusedQuestId()).toBe('c');
  });

  it('focusFirst/focusLast are no-ops when nothing is visible', () => {
    const ctrl = makeController();
    ctrl.focusFirst();
    expect(ctrl.getFocusedQuestId()).toBeNull();
    ctrl.focusLast();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 87: focus Nth quest', () => {
  it('focusNth jumps to the Nth quest in sort order', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'failed' }));
    ctrl.addQuest(makeQuest('c', { state: 'idle' }));
    // Attention sort: b (failed) first, then a, c by insertion.

    ctrl.focusNth(1);
    expect(ctrl.getFocusedQuestId()).toBe('b');
    ctrl.focusNth(2);
    expect(ctrl.getFocusedQuestId()).toBe('a');
    ctrl.focusNth(3);
    expect(ctrl.getFocusedQuestId()).toBe('c');
  });

  it('focusNth is a no-op when the index is out of range', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.setFocusedQuest('a');

    ctrl.focusNth(0);
    expect(ctrl.getFocusedQuestId()).toBe('a');
    ctrl.focusNth(5);
    expect(ctrl.getFocusedQuestId()).toBe('a');
  });

  it('focusNth is a no-op when nothing is visible', () => {
    const ctrl = makeController();
    ctrl.focusNth(1);
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 89: focus next problem quest', () => {
  function makeControllerWithProblems(problemCounts: Record<string, number>) {
    return new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
      getProblemCount: (id) => problemCounts[id] ?? 0,
    });
  }

  it('focusNextProblem cycles through quests with problems', () => {
    const ctrl = makeControllerWithProblems({ a: 0, b: 3, c: 1, d: 0 });
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'running' }));
    ctrl.addQuest(makeQuest('c', { state: 'running' }));
    ctrl.addQuest(makeQuest('d', { state: 'running' }));

    // Only b and c have problems. Cycling should alternate between them.
    ctrl.focusNextProblem();
    expect(ctrl.getFocusedQuestId()).toBe('b');
    ctrl.focusNextProblem();
    expect(ctrl.getFocusedQuestId()).toBe('c');
    ctrl.focusNextProblem();
    expect(ctrl.getFocusedQuestId()).toBe('b');
  });

  it('focusNextProblem is a no-op when no quest has problems', () => {
    const ctrl = makeControllerWithProblems({ a: 0, b: 0 });
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'running' }));
    ctrl.setFocusedQuest('a');

    ctrl.focusNextProblem();
    expect(ctrl.getFocusedQuestId()).toBe('a');
  });

  it('focusNextProblem is a no-op when nothing is visible', () => {
    const ctrl = makeControllerWithProblems({});
    ctrl.focusNextProblem();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 90: focus previous problem quest', () => {
  function makeControllerWithProblems(problemCounts: Record<string, number>) {
    return new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
      getProblemCount: (id) => problemCounts[id] ?? 0,
    });
  }

  it('focusPrevProblem cycles backward through quests with problems', () => {
    const ctrl = makeControllerWithProblems({ a: 0, b: 3, c: 1, d: 0 });
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'running' }));
    ctrl.addQuest(makeQuest('c', { state: 'running' }));
    ctrl.addQuest(makeQuest('d', { state: 'running' }));

    // Only b and c have problems. Cycling backward should alternate,
    // wrapping from the first problem quest to the last.
    ctrl.focusPrevProblem();
    expect(ctrl.getFocusedQuestId()).toBe('c');
    ctrl.focusPrevProblem();
    expect(ctrl.getFocusedQuestId()).toBe('b');
    ctrl.focusPrevProblem();
    expect(ctrl.getFocusedQuestId()).toBe('c');
  });

  it('focusPrevProblem is a no-op when no quest has problems', () => {
    const ctrl = makeControllerWithProblems({ a: 0, b: 0 });
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'running' }));
    ctrl.setFocusedQuest('a');

    ctrl.focusPrevProblem();
    expect(ctrl.getFocusedQuestId()).toBe('a');
  });

  it('focusPrevProblem is a no-op when nothing is visible', () => {
    const ctrl = makeControllerWithProblems({});
    ctrl.focusPrevProblem();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 94: focus next context-risk quest', () => {
  it('focusNextCtxRisk cycles through quests at risk of context exhaustion', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { contextUsage: 0.3 }));
    ctrl.addQuest(makeQuest('b', { contextUsage: 0.85 }));
    ctrl.addQuest(makeQuest('c', { contextUsage: 0.96 }));
    ctrl.addQuest(makeQuest('d', { contextUsage: 0.5 }));

    // Only b (85%) and c (96%) are at risk (>=80%).
    ctrl.focusNextCtxRisk();
    expect(ctrl.getFocusedQuestId()).toBe('b');
    ctrl.focusNextCtxRisk();
    expect(ctrl.getFocusedQuestId()).toBe('c');
    ctrl.focusNextCtxRisk();
    expect(ctrl.getFocusedQuestId()).toBe('b');
  });

  it('focusNextCtxRisk is a no-op when no quest is at risk', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { contextUsage: 0.3 }));
    ctrl.addQuest(makeQuest('b', { contextUsage: 0.5 }));
    ctrl.setFocusedQuest('a');

    ctrl.focusNextCtxRisk();
    expect(ctrl.getFocusedQuestId()).toBe('a');
  });

  it('focusNextCtxRisk is a no-op when nothing is visible', () => {
    const ctrl = makeController();
    ctrl.focusNextCtxRisk();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 97: reverse sort direction', () => {
  it('toggleSortReverse flips the sort order', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { sessionCostUsd: 1 }));
    ctrl.addQuest(makeQuest('b', { sessionCostUsd: 5 }));
    ctrl.addQuest(makeQuest('c', { sessionCostUsd: 3 }));

    // Cost mode: highest first by default.
    ctrl.cycleSortMode(); // attention → cost
    expect(ctrl.getSortMode()).toBe('cost');
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['b', 'c', 'a']);

    // Reverse: lowest first.
    ctrl.toggleSortReverse();
    expect(ctrl.isSortReversed()).toBe(true);
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['a', 'c', 'b']);

    // Toggle back: highest first again.
    ctrl.toggleSortReverse();
    expect(ctrl.isSortReversed()).toBe(false);
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['b', 'c', 'a']);
  });

  it('resetView clears the reversal flag', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a'));
    ctrl.toggleSortReverse();
    expect(ctrl.isSortReversed()).toBe(true);

    ctrl.resetView();
    expect(ctrl.isSortReversed()).toBe(false);
  });
});

describe('Gen 63: focus most expensive quest', () => {
  it('focuses the quest with the highest session cost', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('cheap', { sessionCostUsd: 0.5 }));
    ctrl.addQuest(makeQuest('pricey', { sessionCostUsd: 4.2 }));
    ctrl.addQuest(makeQuest('mid', { sessionCostUsd: 1.8 }));

    ctrl.focusMostExpensive();
    expect(ctrl.getFocusedQuestId()).toBe('pricey');
  });

  it('treats missing cost as zero', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('unknown'));
    ctrl.addQuest(makeQuest('billed', { sessionCostUsd: 0.1 }));

    ctrl.focusMostExpensive();
    expect(ctrl.getFocusedQuestId()).toBe('billed');
  });

  it('is a no-op when no quest is visible', () => {
    const ctrl = makeController();
    ctrl.focusMostExpensive();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 27: auto-pin on attention transition', () => {
  it('fires onAttentionTransition when a quest enters waiting-approval', () => {
    const transitions: Array<[string, string]> = [];
    const ctrl = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
      onAttentionTransition: (id, state) => transitions.push([id, state]),
    });
    ctrl.addQuest(makeQuest('a', { state: 'running' }));

    ctrl.updateQuestState('a', 'waiting-approval');
    expect(transitions).toEqual([['a', 'waiting-approval']]);
  });

  it('fires onAttentionTransition when a quest enters failed', () => {
    const transitions: Array<[string, string]> = [];
    const ctrl = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
      onAttentionTransition: (id, state) => transitions.push([id, state]),
    });
    ctrl.addQuest(makeQuest('b', { state: 'running' }));

    ctrl.updateQuestState('b', 'failed');
    expect(transitions).toEqual([['b', 'failed']]);
  });

  it('does not fire when already in an attention state', () => {
    const transitions: Array<[string, string]> = [];
    const ctrl = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
      onAttentionTransition: (id, state) => transitions.push([id, state]),
    });
    ctrl.addQuest(makeQuest('c', { state: 'waiting-approval' }));

    // Already attention → no transition callback.
    ctrl.updateQuestState('c', 'waiting-approval');
    expect(transitions).toEqual([]);
  });

  it('does not fire for non-attention transitions', () => {
    const transitions: Array<[string, string]> = [];
    const ctrl = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
      onAttentionTransition: (id, state) => transitions.push([id, state]),
    });
    ctrl.addQuest(makeQuest('d', { state: 'running' }));

    ctrl.updateQuestState('d', 'done');
    expect(transitions).toEqual([]);
  });
});

describe('Gen 33: attention dwell stamp on quests', () => {
  it('stamps attentionEnteredAt when a quest enters an attention state', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    expect(ctrl.getQuest('a')?.attentionEnteredAt).toBeUndefined();

    ctrl.updateQuestState('a', 'waiting-approval');
    expect(ctrl.getQuest('a')?.attentionEnteredAt).toBeTypeOf('number');
  });

  it('keeps the original stamp across repeated same-state events', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.updateQuestState('a', 'waiting-approval');
    const first = ctrl.getQuest('a')?.attentionEnteredAt;

    ctrl.updateQuestState('a', 'waiting-approval');
    expect(ctrl.getQuest('a')?.attentionEnteredAt).toBe(first);
  });

  it('clears the stamp when the quest leaves the attention state', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'waiting-approval' }));
    expect(ctrl.getQuest('a')?.attentionEnteredAt).toBeTypeOf('number');

    ctrl.updateQuestState('a', 'running');
    expect(ctrl.getQuest('a')?.attentionEnteredAt).toBeUndefined();
  });

  it('stamps a quest born directly into an attention state', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'failed' }));
    expect(ctrl.getQuest('a')?.attentionEnteredAt).toBeTypeOf('number');
  });
});

describe('Gen 30: dashboard sort mode cycling', () => {
  it('cycles attention → cost → age → name → health → ctx → problems → attention', () => {
    const ctrl = makeController();
    expect(ctrl.getSortMode()).toBe('attention');
    ctrl.cycleSortMode();
    expect(ctrl.getSortMode()).toBe('cost');
    ctrl.cycleSortMode();
    expect(ctrl.getSortMode()).toBe('age');
    ctrl.cycleSortMode();
    expect(ctrl.getSortMode()).toBe('name');
    // Gen 51: health joins the cycle.
    ctrl.cycleSortMode();
    expect(ctrl.getSortMode()).toBe('health');
    // Gen 74: ctx joins the cycle.
    ctrl.cycleSortMode();
    expect(ctrl.getSortMode()).toBe('ctx');
    // Gen 87: problems joins the cycle.
    ctrl.cycleSortMode();
    expect(ctrl.getSortMode()).toBe('problems');
    ctrl.cycleSortMode();
    expect(ctrl.getSortMode()).toBe('attention');
  });

  it('cost mode sorts highest cost first', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('cheap', { sessionCostUsd: 0.5 }));
    ctrl.addQuest(makeQuest('pricey', { sessionCostUsd: 3.2 }));
    ctrl.addQuest(makeQuest('mid', { sessionCostUsd: 1.1 }));

    ctrl.cycleSortMode(); // → cost
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['pricey', 'mid', 'cheap']);
  });

  it('age mode sorts oldest first', () => {
    const now = Date.now();
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('new', { createdAt: now - 1_000 }));
    ctrl.addQuest(makeQuest('old', { createdAt: now - 100_000 }));
    ctrl.addQuest(makeQuest('mid', { createdAt: now - 10_000 }));

    ctrl.cycleSortMode(); // → cost
    ctrl.cycleSortMode(); // → age
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['old', 'mid', 'new']);
  });

  it('name mode sorts alphabetically', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('c', { name: 'charlie' }));
    ctrl.addQuest(makeQuest('a', { name: 'alpha' }));
    ctrl.addQuest(makeQuest('b', { name: 'bravo' }));

    ctrl.cycleSortMode(); // → cost
    ctrl.cycleSortMode(); // → age
    ctrl.cycleSortMode(); // → name
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['a', 'b', 'c']);
  });

  it('Gen 51: health mode sorts least-healthy first', () => {
    const ctrl = makeController();
    // failed (10) < blocked (45) < running (90) by health score.
    ctrl.addQuest(makeQuest('healthy', { state: 'running' }));
    ctrl.addQuest(makeQuest('critical', { state: 'failed' }));
    ctrl.addQuest(makeQuest('shaky', { state: 'blocked' }));

    ctrl.cycleSortMode(); // → cost
    ctrl.cycleSortMode(); // → age
    ctrl.cycleSortMode(); // → name
    ctrl.cycleSortMode(); // → health
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['critical', 'shaky', 'healthy']);
  });

  it('Gen 74: ctx mode sorts highest context usage first', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('low', { contextUsage: 0.2 }));
    ctrl.addQuest(makeQuest('high', { contextUsage: 0.95 }));
    ctrl.addQuest(makeQuest('mid', { contextUsage: 0.6 }));

    ctrl.cycleSortMode(); // → cost
    ctrl.cycleSortMode(); // → age
    ctrl.cycleSortMode(); // → name
    ctrl.cycleSortMode(); // → health
    ctrl.cycleSortMode(); // → ctx
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['high', 'mid', 'low']);
  });

  it('Gen 85: problems mode sorts most error/warning lines first', () => {
    const problemCounts: Record<string, number> = { clean: 0, shaky: 2, broken: 5 };
    const ctrl = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
      getProblemCount: (id) => problemCounts[id] ?? 0,
    });
    ctrl.addQuest(makeQuest('clean', { state: 'running' }));
    ctrl.addQuest(makeQuest('broken', { state: 'running' }));
    ctrl.addQuest(makeQuest('shaky', { state: 'running' }));

    ctrl.cycleSortMode(); // → cost
    ctrl.cycleSortMode(); // → age
    ctrl.cycleSortMode(); // → name
    ctrl.cycleSortMode(); // → health
    ctrl.cycleSortMode(); // → ctx
    ctrl.cycleSortMode(); // → problems
    expect(ctrl.getQuests().map((q) => q.id)).toEqual(['broken', 'shaky', 'clean']);
  });
});

describe('Gen 54: resetView restores baseline view state', () => {
  it('clears filter, attention-only, and sort mode in one shot', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'failed' }));

    // Mutate every piece of view state.
    ctrl.setFilter('zzz');
    ctrl.setAttentionOnly(true);
    ctrl.setCtxRiskOnly(true);
    ctrl.cycleSortMode(); // → cost
    expect(ctrl.getFilter()).toBe('zzz');
    expect(ctrl.isAttentionOnly()).toBe(true);
    expect(ctrl.isCtxRiskOnly()).toBe(true);
    expect(ctrl.getSortMode()).toBe('cost');

    // Reset returns everything to defaults.
    ctrl.resetView();
    expect(ctrl.getFilter()).toBe('');
    expect(ctrl.isAttentionOnly()).toBe(false);
    expect(ctrl.isCtxRiskOnly()).toBe(false);
    expect(ctrl.getSortMode()).toBe('attention');
  });
});

describe('Gen 29: context usage mini-bar', () => {
  it('renders a proportional 5-cell bar with the percentage', () => {
    expect(renderContextBar(0.62)).toBe('ctx ▓▓▓░░ 62%');
  });

  it('renders an empty bar for zero usage', () => {
    expect(renderContextBar(0)).toBe('ctx ░░░░░ 0%');
  });

  it('renders a full bar at 100% usage', () => {
    expect(renderContextBar(1)).toBe('ctx ▓▓▓▓▓ 100%');
  });

  it('clamps out-of-range usage into 0–100', () => {
    expect(renderContextBar(1.5)).toBe('ctx ▓▓▓▓▓ 100%');
    expect(renderContextBar(-0.2)).toBe('ctx ░░░░░ 0%');
  });

  it('rounds the fill to the nearest cell', () => {
    // 40% → 2 of 5 cells filled.
    expect(renderContextBar(0.4)).toBe('ctx ▓▓░░░ 40%');
  });
});

describe('Gen 31: todo progress mini-bar', () => {
  it('renders a proportional 5-cell bar with the count', () => {
    expect(renderTodoBar(3, 5)).toBe('☑ ▓▓▓░░ 3/5');
  });

  it('renders an empty bar for zero done', () => {
    expect(renderTodoBar(0, 4)).toBe('☑ ░░░░░ 0/4');
  });

  it('renders a full bar when all done', () => {
    expect(renderTodoBar(6, 6)).toBe('☑ ▓▓▓▓▓ 6/6');
  });

  it('clamps done above total into a full bar', () => {
    expect(renderTodoBar(9, 5)).toBe('☑ ▓▓▓▓▓ 9/5');
  });

  it('rounds the fill to the nearest cell', () => {
    // 2/5 = 40% → 2 of 5 cells filled.
    expect(renderTodoBar(2, 5)).toBe('☑ ▓▓░░░ 2/5');
  });
});

describe('Gen 32: colorized change-count stats', () => {
  it('includes the added and removed counts', () => {
    const out = renderChangeCount({ added: 3, removed: 1 });
    expect(out).toContain('+3');
    expect(out).toContain('-1');
  });

  it('renders zero changes', () => {
    const out = renderChangeCount({ added: 0, removed: 0 });
    expect(out).toContain('+0');
    expect(out).toContain('-0');
  });
});

describe('Gen 48: colorized health score', () => {
  it('renders the score value with a heart glyph', () => {
    expect(renderHealthScore(82)).toContain('♥ 82');
  });

  it('renders low and critical scores', () => {
    expect(renderHealthScore(15)).toContain('♥ 15');
    expect(renderHealthScore(45)).toContain('♥ 45');
  });
});

describe('Gen 33: running spinner animation', () => {
  it('advances frames over time', () => {
    const f0 = spinnerFrame(0);
    const f1 = spinnerFrame(100);
    const f2 = spinnerFrame(200);
    expect(f0).not.toBe(f1);
    expect(f1).not.toBe(f2);
  });

  it('stays on the same frame within a 100ms window', () => {
    expect(spinnerFrame(1000)).toBe(spinnerFrame(1099));
  });

  it('cycles back to the first frame after 10 steps', () => {
    expect(spinnerFrame(0)).toBe(spinnerFrame(1000));
  });
});

describe('Gen 34: context action-hint bar', () => {
  it('shows general navigation hints when nothing is focused', () => {
    const hint = actionHintBar(undefined);
    expect(hint).toContain('j/k move');
    expect(hint).toContain('Enter pin');
    expect(hint).not.toContain('approve');
  });

  it('shows approval shortcuts for a focused waiting-approval quest', () => {
    const quest = makeQuest('q1', { state: 'waiting-approval', name: 'Auth Fix' });
    const hint = actionHintBar(quest);
    expect(hint).toContain('Auth Fix');
    expect(hint).toContain('a approve');
    expect(hint).toContain('x reject');
    expect(hint).toContain('r rewind');
  });

  it('shows approval shortcuts for a focused failed quest', () => {
    const quest = makeQuest('q2', { state: 'failed' });
    const hint = actionHintBar(quest);
    expect(hint).toContain('approve');
  });

  it('does not show approval shortcuts for a healthy focused quest', () => {
    const quest = makeQuest('q3', { state: 'running' });
    const hint = actionHintBar(quest);
    expect(hint).not.toContain('approve');
    expect(hint).toContain('j/k move');
  });
});

describe('Gen 31: idle-duration severity token', () => {
  const MIN = 60_000;

  it('returns muted for fresh sessions', () => {
    expect(idleSeverityToken(0)).toBe('muted');
    expect(idleSeverityToken(4 * MIN)).toBe('muted');
    expect(idleSeverityToken(5 * MIN - 1)).toBe('muted');
  });

  it('returns warning at and past 5 minutes', () => {
    expect(idleSeverityToken(5 * MIN)).toBe('warning');
    expect(idleSeverityToken(10 * MIN)).toBe('warning');
    expect(idleSeverityToken(15 * MIN - 1)).toBe('warning');
  });

  it('returns error at and past 15 minutes', () => {
    expect(idleSeverityToken(15 * MIN)).toBe('error');
    expect(idleSeverityToken(60 * MIN)).toBe('error');
  });

  it('clamps negative durations to muted', () => {
    expect(idleSeverityToken(-1000)).toBe('muted');
  });
});

describe('Gen 37: thumbnail strip state coloring', () => {
  it('carries the quest state on each thumbnail entry', () => {
    const quests = [
      makeQuest('a', { state: 'running' }),
      makeQuest('b', { state: 'failed' }),
    ];
    const entries = buildThumbnailStrip(quests, null, false);
    expect(entries.map((e) => e.state)).toEqual(['running', 'failed']);
  });

  it('excludes the pinned quest from the strip', () => {
    const quests = [
      makeQuest('a', { state: 'running' }),
      makeQuest('b', { state: 'failed' }),
    ];
    const entries = buildThumbnailStrip(quests, 'a', false);
    expect(entries.map((e) => e.questId)).toEqual(['b']);
  });

  it('renders the quest label and icon in each segment', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Alpha' })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 80, false);
    expect(line).toContain('Alpha');
    expect(line).toContain('●');
  });

  it('prefixes numbered hotkeys when showIndex is set', () => {
    const quests = [
      makeQuest('a', { state: 'running', name: 'Alpha' }),
      makeQuest('b', { state: 'idle', name: 'Beta' }),
    ];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 80, true);
    expect(line).toContain('1:');
    expect(line).toContain('2:');
  });
});

describe('Gen 37: thumbnail strip state coloring', () => {
  it('builds entries carrying the quest state', () => {
    const quests = [
      makeQuest('a', { state: 'running', name: 'Alpha' }),
      makeQuest('b', { state: 'failed', name: 'Beta' }),
    ];
    const entries = buildThumbnailStrip(quests, null, false);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.state).toBe('running');
    expect(entries[1]!.state).toBe('failed');
  });

  it('excludes the pinned quest from the strip', () => {
    const quests = [
      makeQuest('a', { state: 'running' }),
      makeQuest('b', { state: 'failed' }),
    ];
    const entries = buildThumbnailStrip(quests, 'a', false);
    expect(entries.map((e) => e.questId)).toEqual(['b']);
  });

  it('renders each segment with its label', () => {
    const quests = [makeQuest('a', { state: 'failed', name: 'Boom' })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 80, false);
    // The segment text is preserved (color wraps it when the terminal supports it).
    expect(line).toContain('Boom');
    expect(line).toContain('[');
    expect(line).toContain(']');
  });

  it('prefixes numbered hotkeys when showIndex is set', () => {
    const quests = [
      makeQuest('a', { state: 'running', name: 'One' }),
      makeQuest('b', { state: 'idle', name: 'Two' }),
    ];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, true);
    expect(line).toContain('1:');
    expect(line).toContain('2:');
  });
});

describe('Gen 38: thumbnail strip todo progress', () => {
  it('carries todo progress into entries', () => {
    const quests = [makeQuest('a', { state: 'running', todoProgress: { done: 2, total: 5 } })];
    const entries = buildThumbnailStrip(quests, null, false);
    expect(entries[0]!.todoProgress).toEqual({ done: 2, total: 5 });
  });

  it('renders the compact done/total count in the segment', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Work', todoProgress: { done: 3, total: 7 } })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).toContain('3/7');
  });

  it('omits the count when there is no todo progress', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Work' })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).not.toContain('/');
  });

  it('omits the count when total is zero', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Work', todoProgress: { done: 0, total: 0 } })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).not.toContain('0/0');
  });
});

describe('Gen 60: thumbnail strip context usage', () => {
  it('carries context usage into entries', () => {
    const quests = [makeQuest('a', { state: 'running', contextUsage: 0.62 })];
    const entries = buildThumbnailStrip(quests, null, false);
    expect(entries[0]!.contextUsage).toBe(0.62);
  });

  it('renders the compact context percentage in the segment', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Work', contextUsage: 0.62 })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).toContain('62%');
  });

  it('omits the tag when there is no context usage', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Work' })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).not.toContain('%');
  });

  it('omits the tag when context usage is zero', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Work', contextUsage: 0 })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).not.toContain('%');
  });
});

describe('Gen 62: thumbnail strip health score', () => {
  const NOW = 1_000_000;

  it('carries the composite health score into entries', () => {
    // running with fresh activity → health 90.
    const quests = [makeQuest('a', { state: 'running', lastActivityAt: NOW })];
    const entries = buildThumbnailStrip(quests, null, false, NOW);
    expect(entries[0]!.healthScore).toBe(90);
  });

  it('renders the compact health score in the segment', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Work', lastActivityAt: NOW })];
    const entries = buildThumbnailStrip(quests, null, false, NOW);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).toContain('♥90');
  });

  it('shows a low score for a failed quest', () => {
    const quests = [makeQuest('a', { state: 'failed', name: 'Boom', lastActivityAt: NOW })];
    const entries = buildThumbnailStrip(quests, null, false, NOW);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).toContain('♥10');
  });
});

describe('Gen 104: thumbnail strip approval marker', () => {
  it('flags approval-pending quests in entries', () => {
    const quests = [
      makeQuest('a', { state: 'waiting-approval', name: 'Wait' }),
      makeQuest('b', { state: 'running', name: 'Run' }),
    ];
    const entries = buildThumbnailStrip(quests, null, false);
    expect(entries[0]!.awaitingApproval).toBe(true);
    expect(entries[1]!.awaitingApproval).toBe(false);
  });

  it('renders the approval marker for waiting quests', () => {
    const quests = [makeQuest('a', { state: 'waiting-approval', name: 'Wait' })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).toContain('⏳');
  });

  it('omits the approval marker for non-waiting quests', () => {
    const quests = [makeQuest('a', { state: 'running', name: 'Run' })];
    const entries = buildThumbnailStrip(quests, null, false);
    const line = renderThumbnailStripLine(entries, 120, false);
    expect(line).not.toContain('⏳');
  });
});

describe('Gen 39: ensureFocus lands on the most urgent quest', () => {
  it('focuses the most urgent quest when nothing is focused', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('running', { state: 'running' }));
    ctrl.addQuest(makeQuest('approval', { state: 'waiting-approval' }));
    ctrl.addQuest(makeQuest('idle', { state: 'idle' }));

    expect(ctrl.getFocusedQuestId()).toBeNull();
    ctrl.ensureFocus();
    // waiting-approval is the most urgent (state priority 0).
    expect(ctrl.getFocusedQuestId()).toBe('approval');
  });

  it('keeps a valid existing focus', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'running' }));
    ctrl.setFocusedQuest('b');

    ctrl.ensureFocus();
    expect(ctrl.getFocusedQuestId()).toBe('b');
  });

  it('re-focuses when the focused quest disappears', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.addQuest(makeQuest('b', { state: 'failed' }));
    ctrl.setFocusedQuest('a');

    ctrl.removeQuest('a');
    ctrl.ensureFocus();
    // 'a' is gone; focus snaps to the most urgent remaining quest.
    expect(ctrl.getFocusedQuestId()).toBe('b');
  });

  it('re-focuses when the focused quest is filtered out', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('alpha', { name: 'alpha', state: 'running' }));
    ctrl.addQuest(makeQuest('beta', { name: 'beta', state: 'running' }));
    ctrl.setFocusedQuest('alpha');

    ctrl.setFilter('beta');
    ctrl.ensureFocus();
    expect(ctrl.getFocusedQuestId()).toBe('beta');
  });

  it('clears focus when no quests remain', () => {
    const ctrl = makeController();
    ctrl.addQuest(makeQuest('a', { state: 'running' }));
    ctrl.setFocusedQuest('a');
    ctrl.removeQuest('a');

    ctrl.ensureFocus();
    expect(ctrl.getFocusedQuestId()).toBeNull();
  });
});

describe('Gen 69: cell stream preview colorization', () => {
  it('highlightStreamLine preserves error line content', () => {
    // In a colorless test theme fg() is a no-op, so assert content survives
    // (the severity coloring itself is theme-dependent).
    const out = highlightStreamLine('fatal: build failed');
    expect(out).toContain('fatal: build failed');
  });

  it('highlightStreamLine preserves warning line content', () => {
    const out = highlightStreamLine('warning: deprecated API');
    expect(out).toContain('warning: deprecated API');
  });

  it('highlightStreamLine leaves ordinary lines untouched', () => {
    expect(highlightStreamLine('all good here')).toBe('all good here');
  });

  it('highlightStreamLine does not double-color ANSI lines', () => {
    const ansi = '\x1b[31malready red\x1b[0m';
    expect(highlightStreamLine(ansi)).toBe(ansi);
  });
});
