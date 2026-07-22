import { describe, expect, it } from 'vitest';

import { QuestGridController } from '#/tui/controllers/quest-grid-controller';
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
