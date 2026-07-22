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

  it('Gen 37: pinPrevious returns to the previously pinned quest', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    pin.pin('b');
    expect(pin.getPinnedQuest()?.id).toBe('b');
    expect(pin.canPinPrevious).toBe(true);

    expect(pin.pinPrevious()).toBe(true);
    expect(pin.getPinnedQuest()?.id).toBe('a');
  });

  it('Gen 37: pinPrevious allows navigating forward again', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    pin.pin('b');
    pin.pinPrevious(); // → a
    expect(pin.getPinnedQuest()?.id).toBe('a');

    // The outgoing pin (b) was pushed, so we can go forward again.
    expect(pin.pinPrevious()).toBe(true);
    expect(pin.getPinnedQuest()?.id).toBe('b');
  });

  it('Gen 37: pinPrevious returns false with empty history', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    expect(pin.canPinPrevious).toBe(false);
    expect(pin.pinPrevious()).toBe(false);
    expect(pin.getPinnedQuest()?.id).toBe('a');
  });

  it('Gen 37: pinPrevious skips quests that were removed', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    grid.addQuest(makeQuest('c'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    pin.pin('b');
    pin.pin('c');
    // Remove b so the back-stack must skip it and land on a.
    grid.removeQuest('b');

    expect(pin.pinPrevious()).toBe(true);
    expect(pin.getPinnedQuest()?.id).toBe('a');
  });

  it('Gen 39: pinNextInStrip cycles forward through display order', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    grid.addQuest(makeQuest('c'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    pin.pinNextInStrip();
    expect(pin.getPinnedQuest()?.id).toBe('b');
    pin.pinNextInStrip();
    expect(pin.getPinnedQuest()?.id).toBe('c');
    // Wraps back to the first quest.
    pin.pinNextInStrip();
    expect(pin.getPinnedQuest()?.id).toBe('a');
  });

  it('Gen 39: pinPrevInStrip cycles backward with wrap', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    grid.addQuest(makeQuest('c'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    pin.pinPrevInStrip();
    expect(pin.getPinnedQuest()?.id).toBe('c');
    pin.pinPrevInStrip();
    expect(pin.getPinnedQuest()?.id).toBe('b');
  });

  it('Gen 39: cycling is a no-op with a single quest', () => {
    const grid = makeGrid();
    grid.addQuest(makeQuest('a'));
    const pin = new PinController({ gridController: grid, requestRender: () => {} });

    pin.pin('a');
    pin.pinNextInStrip();
    expect(pin.getPinnedQuest()?.id).toBe('a');
    pin.pinPrevInStrip();
    expect(pin.getPinnedQuest()?.id).toBe('a');
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

  it('Gen 33: expand view header shows dwell time for attention quests', () => {
    // Entered the attention state 90s ago.
    const quest = makeQuest('a', {
      state: 'waiting-approval',
      attentionEnteredAt: Date.now() - 90_000,
    });
    const view = new QuestExpandView();
    view.appendLine('line 1');

    const lines = view.render(quest, 100);
    // The dwell time appears on the second header line.
    expect(lines[1]).toContain('⏳ waiting');
  });

  it('Gen 33: expand view header hides dwell time for healthy quests', () => {
    const quest = makeQuest('a', { state: 'running' });
    const view = new QuestExpandView();
    view.appendLine('line 1');

    const lines = view.render(quest, 100);
    expect(lines[1]).not.toContain('⏳ waiting');
  });

  it('Gen 38: expand view header shows model name and session cost', () => {
    const quest = makeQuest('a', {
      state: 'running',
      modelName: 'kimi-k2',
      sessionCostUsd: 1.23,
    });
    const view = new QuestExpandView();
    view.appendLine('line 1');

    const lines = view.render(quest, 120);
    // Model + cost appear on the third header line (index 2).
    expect(lines[2]).toContain('kimi-k2');
    expect(lines[2]).toContain('$1.23');
  });

  it('Gen 38: expand view header omits cost when zero', () => {
    const quest = makeQuest('a', { state: 'running', sessionCostUsd: 0 });
    const view = new QuestExpandView();
    view.appendLine('line 1');

    const lines = view.render(quest, 120);
    expect(lines[2]).not.toContain('$');
  });

  it('Gen 39: expand view header shows last error for failed quests', () => {
    const quest = makeQuest('a', {
      state: 'failed',
      lastErrorMessage: 'OAuth credentials rejected',
    });
    const view = new QuestExpandView();
    view.appendLine('line 1');

    const lines = view.render(quest, 120);
    expect(lines[2]).toContain('✗ OAuth credentials rejected');
  });

  it('Gen 39: expand view header shows plan step for healthy quests', () => {
    const quest = makeQuest('a', { state: 'running', planStep: 'Building feature' });
    const view = new QuestExpandView();
    view.appendLine('line 1');

    const lines = view.render(quest, 120);
    expect(lines[2]).toContain('▸ Building feature');
    expect(lines[2]).not.toContain('✗');
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

  it('Gen 15: page scroll and top/bottom jumps', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(5);
    for (let i = 0; i < 30; i++) {
      view.appendLine(`line ${i}`);
    }
    // Starts at bottom (offset 25).
    expect(view.currentScrollOffset).toBe(25);

    // Page up moves by viewport-1 (4).
    view.scrollPageUp();
    expect(view.currentScrollOffset).toBe(21);

    // Jump to top.
    view.scrollToTop();
    expect(view.currentScrollOffset).toBe(0);

    // Page down from top.
    view.scrollPageDown();
    expect(view.currentScrollOffset).toBe(4);

    // Jump to bottom.
    view.scrollToBottom();
    expect(view.currentScrollOffset).toBe(25);
  });

  it('Gen 16: search finds matches and jumps to them', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(5);
    view.appendLines([
      'apple pie',
      'banana bread',
      'apple sauce',
      'cherry tart',
      'apple crumble',
      'date cake',
      'elderberry jam',
      'fig newton',
      'grapefruit',
      'honeydew',
    ]);
    // Search for "apple" — 3 matches, jumps to first (line 0).
    const count = view.startSearch('apple');
    expect(count).toBe(3);
    expect(view.currentScrollOffset).toBe(0);

    // Status reflects 1/3.
    let status = view.getSearchStatus();
    expect(status?.current).toBe(1);
    expect(status?.total).toBe(3);

    // Next → 2nd match (line 2).
    view.searchNext();
    status = view.getSearchStatus();
    expect(status?.current).toBe(2);

    // Next again → 3rd match (line 4).
    view.searchNext();
    status = view.getSearchStatus();
    expect(status?.current).toBe(3);

    // Next wraps to 1st match.
    view.searchNext();
    status = view.getSearchStatus();
    expect(status?.current).toBe(1);

    // Prev wraps back to 3rd match.
    view.searchPrev();
    status = view.getSearchStatus();
    expect(status?.current).toBe(3);
  });

  it('Gen 16: search is case-insensitive and clearable', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(5);
    view.appendLines(['Hello World', 'hello there', 'HELLO AGAIN']);
    expect(view.startSearch('hello')).toBe(3);
    expect(view.getSearchStatus()).not.toBeNull();

    view.clearSearch();
    expect(view.getSearchStatus()).toBeNull();
  });

  it('Gen 16: no matches returns 0 and status shows 0/0', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(5);
    view.appendLines(['foo', 'bar', 'baz']);
    expect(view.startSearch('xyz')).toBe(0);
    const status = view.getSearchStatus();
    expect(status?.current).toBe(0);
    expect(status?.total).toBe(0);
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

  it('Gen 28: shows inline approval prompt when waiting-approval', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(5);
    view.appendLines(['line 1', 'line 2']);
    const quest = makeQuest('q1', {
      state: 'waiting-approval',
      pendingApprovalSummary: 'Edit src/app.ts',
    });
    const lines = view.render(quest, 80);
    const joined = lines.join('\n');
    expect(joined).toContain('Edit src/app.ts');
    expect(joined).toContain('[a] approve');
    expect(joined).toContain('[x] reject');
    expect(joined).toContain('[r] rewind');
  });

  it('Gen 28: no approval prompt for non-approval states', () => {
    const view = new QuestExpandView();
    view.setMaxVisibleLines(5);
    view.appendLines(['line 1']);
    const quest = makeQuest('q2', { state: 'running' });
    const lines = view.render(quest, 80);
    const joined = lines.join('\n');
    expect(joined).not.toContain('[a] approve');
  });
});
