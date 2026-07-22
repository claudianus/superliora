import { describe, expect, it, vi } from 'vitest';

import { PinController } from '#/tui/controllers/pin-controller';
import { QuestGridController } from '#/tui/controllers/quest-grid-controller';
import { QuestExpandView } from '#/tui/components/panes/quest-expand-view';
import type { Quest } from '#/tui/controllers/quest-types';

function makeQuest(id: string, overrides: Partial<Quest> = {}): Quest {
  return {
    id,
    name: `Quest ${id}`,
    sessionRef: `session-${id}`,
    state: 'running',
    createdAt: Date.now() - 60_000,
    lastActivityAt: Date.now(),
    changeCount: { added: 2, removed: 0 },
    planStep: 'Working',
    worktreePath: `/tmp/wt/${id}`,
    pinned: false,
    approvalPending: false,
    ...overrides,
  };
}

function makeGrid() {
  return new QuestGridController({
    getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
    requestRender: () => {},
  });
}

describe('hybrid pin/expand toggle (AC-3)', () => {
  it('togglePin pins a quest and switches view mode', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.togglePin('a');
    expect(pin.isPinned).toBe(true);
    expect(pin.getPinnedQuest()?.id).toBe('a');
    expect(grid.getViewMode()).toBe('pinned');
  });

  it('togglePin on already-pinned quest unpins it', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.togglePin('a');
    expect(pin.isPinned).toBe(true);
    pin.togglePin('a');
    expect(pin.isPinned).toBe(false);
    expect(grid.getViewMode()).toBe('dashboard');
  });

  it('pin() is idempotent for already-pinned quest', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    expect(pin.isPinned).toBe(true);
    pin.pin('a'); // should not toggle off
    expect(pin.isPinned).toBe(true);
  });

  it('unpin() returns to dashboard mode', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    pin.unpin();
    expect(pin.isPinned).toBe(false);
    expect(grid.getViewMode()).toBe('dashboard');
  });

  it('getStripQuests excludes the pinned quest', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    grid.addQuest(makeQuest('c'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    const strip = pin.getStripQuests();
    expect(strip.map((q) => q.id)).toEqual(['b', 'c']);
  });

  it('getStripQuests returns empty when nothing is pinned', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    expect(pin.getStripQuests()).toEqual([]);
  });

  it('pinned quest cell gets larger span in layout', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    grid.addQuest(makeQuest('c'));
    grid.togglePin('a');

    const bounds = grid.getQuestCellBounds('a');
    expect(bounds).not.toBeNull();
    expect(bounds!.colSpan).toBeGreaterThanOrEqual(2);
    expect(bounds!.rowSpan).toBeGreaterThanOrEqual(2);
  });

  it('expand view renders header with quest name and state', () => {
    const quest = makeQuest('a', { name: 'My Quest', state: 'running', planStep: 'Step 1' });
    const view = new QuestExpandView();
    view.appendLine('line 1');
    view.appendLine('line 2');

    const lines = view.render(quest, 80);
    // Gen 11: header is now 3 lines + separator before stream content
    expect(lines[0]).toContain('My Quest');
    expect(lines[0]).toContain('running');
    expect(lines[2]).toContain('Step 1');
    expect(lines[4]).toBe('line 1');
    expect(lines[5]).toBe('line 2');
  });

  it('expand view auto-scrolls when exceeding max visible lines', () => {
    const quest = makeQuest('a');
    const view = new QuestExpandView();
    view.setMaxVisibleLines(3);
    for (let i = 0; i < 10; i++) {
      view.appendLine(`line ${i}`);
    }

    const visible = view.getVisibleLines();
    expect(visible).toHaveLength(3);
    expect(visible[0]).toBe('line 7');
    expect(visible[2]).toBe('line 9');
  });

  it('expand view scroll up/down works', () => {
    const quest = makeQuest('a');
    const view = new QuestExpandView();
    view.setMaxVisibleLines(3);
    for (let i = 0; i < 10; i++) {
      view.appendLine(`line ${i}`);
    }

    view.scrollUp(2);
    expect(view.currentScrollOffset).toBe(5);
    view.scrollDown(1);
    expect(view.currentScrollOffset).toBe(6);
  });

  it('Gen 14: scrolled-up view does not auto-follow new lines', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(3);
    for (let i = 0; i < 10; i++) {
      view.appendLine(`line ${i}`);
    }
    // Parked at bottom (offset 7). Scroll up to review history.
    view.scrollUp(4);
    expect(view.currentScrollOffset).toBe(3);

    // New output arrives while reviewing — viewport must stay put.
    view.appendLine('line 10');
    view.appendLines(['line 11', 'line 12']);
    expect(view.currentScrollOffset).toBe(3);
    expect(view.getVisibleLines()[0]).toBe('line 3');
  });

  it('Gen 14: bottom-parked view follows new lines', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(3);
    for (let i = 0; i < 10; i++) {
      view.appendLine(`line ${i}`);
    }
    expect(view.currentScrollOffset).toBe(7);

    // At bottom — new output should be followed.
    view.appendLine('line 10');
    expect(view.currentScrollOffset).toBe(8);
    expect(view.getVisibleLines()[2]).toBe('line 10');
  });

  it('Gen 14: header shows scroll position and ↑ when not at tail', () => {
    const quest = makeQuest('a', { name: 'Q', state: 'running' });
    const view = new QuestExpandView();
    view.setMaxVisibleLines(3);
    for (let i = 0; i < 10; i++) {
      view.appendLine(`line ${i}`);
    }
    // At tail: no ↑ marker.
    expect(view.render(quest, 80)[0]).not.toContain('↑');
    // Scroll up: ↑ marker appears.
    view.scrollUp(3);
    expect(view.render(quest, 80)[0]).toContain('↑');
  });

  it('removing pinned quest resets pin state', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    grid.togglePin('a');
    expect(grid.getViewMode()).toBe('pinned');

    grid.removeQuest('a');
    expect(grid.getPinnedQuestId()).toBeNull();
    expect(grid.getViewMode()).toBe('dashboard');
  });
});
