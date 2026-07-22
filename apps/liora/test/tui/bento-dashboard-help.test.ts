import { describe, expect, it } from 'vitest';

import { AttentionController } from '#/tui/controllers/attention-controller';
import { PinController } from '#/tui/controllers/pin-controller';
import { QuestGridController } from '#/tui/controllers/quest-grid-controller';
import type { Quest } from '#/tui/controllers/quest-types';
import { BentoDashboardComponent } from '#/tui/components/panes/bento-dashboard';
import { QuestExpandView } from '#/tui/components/panes/quest-expand-view';

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

function makeComponent() {
  const grid = new QuestGridController({
    getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
    requestRender: () => {},
  });
  grid.addQuest(makeQuest('a'));
  grid.addQuest(makeQuest('b'));
  const attention = new AttentionController({
    writeRaw: () => {},
    requestRender: () => {},
  });
  const pin = new PinController({ gridController: grid, requestRender: () => {} });
  let closed = false;
  const component = new BentoDashboardComponent({
    gridController: grid,
    attentionController: attention,
    pinController: pin,
    expandViews: new Map(),
    blinkPhase: false,
    onClose: () => {
      closed = true;
    },
  });
  return { component, grid, pin, isClosed: () => closed };
}

describe('Gen 22: context-aware help overlay', () => {
  it('? opens dashboard help and any key dismisses it', () => {
    const { component } = makeComponent();

    // Before: normal dashboard render (no help title).
    expect(component.render(120).join('\n')).not.toContain('Dashboard Help');

    // ? opens help.
    component.handleInput('?');
    const helpLines = component.render(120).join('\n');
    expect(helpLines).toContain('Dashboard Help');
    expect(helpLines).toContain('Move focus between quests');
    // Gen 55: the reset-view key is documented.
    expect(helpLines).toContain('Reset view');

    // Any key dismisses help (consumed, not acted on).
    component.handleInput('j');
    expect(component.render(120).join('\n')).not.toContain('Dashboard Help');
  });

  it('Esc closes help first, not the whole dashboard', () => {
    const { component, isClosed } = makeComponent();

    component.handleInput('?');
    expect(component.render(120).join('\n')).toContain('Dashboard Help');

    // Esc dismisses help but keeps the dashboard open.
    component.handleInput('\x1b');
    expect(isClosed()).toBe(false);
    expect(component.render(120).join('\n')).not.toContain('Dashboard Help');

    // A second Esc now closes the dashboard.
    component.handleInput('\x1b');
    expect(isClosed()).toBe(true);
  });

  it('pinned mode shows the pinned help with stream shortcuts', () => {
    const { component, grid, pin } = makeComponent();
    pin.pin('a');
    expect(grid.getPinnedQuestId()).toBe('a');

    component.handleInput('?');
    const helpLines = component.render(120).join('\n');
    expect(helpLines).toContain('Pinned Quest Help');
    expect(helpLines).toContain('Scroll the live stream');
    expect(helpLines).toContain('Search');
  });
});

describe('Gen 43: Esc unpins before closing', () => {
  it('Esc in pinned mode unpins first, does not close', () => {
    const { component, grid, pin, isClosed } = makeComponent();
    pin.pin('a');
    expect(grid.getPinnedQuestId()).toBe('a');

    // First Esc unpins.
    component.handleInput('\x1b');
    expect(grid.getPinnedQuestId()).toBeNull();
    expect(isClosed()).toBe(false);

    // Second Esc now closes the dashboard.
    component.handleInput('\x1b');
    expect(isClosed()).toBe(true);
  });

  it('Esc in dashboard mode closes directly', () => {
    const { component, isClosed } = makeComponent();

    component.handleInput('\x1b');
    expect(isClosed()).toBe(true);
  });
});

describe('Gen 56: Esc exits diff-only before unpinning', () => {
  it('Esc in pinned diff-only mode exits diff-only first, then unpins', () => {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a'));
    grid.addQuest(makeQuest('b'));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const view = new QuestExpandView();
    const expandViews = new Map([['a', view]]);
    let closed = false;
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews,
      blinkPhase: false,
      onClose: () => {
        closed = true;
      },
    });

    pin.pin('a');
    expect(grid.getPinnedQuestId()).toBe('a');

    // Enable diff-only mode.
    component.handleInput('d');
    expect(view.isDiffOnly()).toBe(true);

    // First Esc exits diff-only, stays pinned.
    component.handleInput('\x1b');
    expect(view.isDiffOnly()).toBe(false);
    expect(grid.getPinnedQuestId()).toBe('a');
    expect(closed).toBe(false);

    // Second Esc unpins.
    component.handleInput('\x1b');
    expect(grid.getPinnedQuestId()).toBeNull();
    expect(closed).toBe(false);
  });
});
