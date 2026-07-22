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
