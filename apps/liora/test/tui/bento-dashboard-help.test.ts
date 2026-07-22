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

describe('Gen 65: pinned quest info overlay', () => {
  it('i opens the info overlay with quest details in pinned mode', () => {
    const { component, pin } = makeComponent();
    pin.pin('a');

    // Before: no info overlay.
    expect(component.render(120).join('\n')).not.toContain('Worktree');

    // i opens the info overlay.
    component.handleInput('i');
    const infoLines = component.render(120).join('\n');
    expect(infoLines).toContain('Quest a');
    expect(infoLines).toContain('Worktree');
    expect(infoLines).toContain('Health');
  });

  it('any key dismisses the info overlay (consumed, not acted on)', () => {
    const { component, pin, grid } = makeComponent();
    pin.pin('a');

    component.handleInput('i');
    expect(component.render(120).join('\n')).toContain('Worktree');

    // j would normally scroll, but here it only dismisses the overlay.
    component.handleInput('j');
    expect(component.render(120).join('\n')).not.toContain('Worktree');
    // Still pinned — the key was consumed by the overlay.
    expect(grid.getPinnedQuestId()).toBe('a');
  });

  it('Esc closes the info overlay first, not unpin', () => {
    const { component, pin, grid, isClosed } = makeComponent();
    pin.pin('a');

    component.handleInput('i');
    expect(component.render(120).join('\n')).toContain('Worktree');

    // Esc dismisses the overlay but stays pinned.
    component.handleInput('\x1b');
    expect(grid.getPinnedQuestId()).toBe('a');
    expect(isClosed()).toBe(false);
    expect(component.render(120).join('\n')).not.toContain('Worktree');
  });
});

describe('Gen 66: dashboard fleet summary overlay', () => {
  it('c opens the fleet summary overlay in dashboard mode', () => {
    const { component } = makeComponent();

    // Before: no fleet summary.
    expect(component.render(120).join('\n')).not.toContain('Fleet Summary');

    // c opens the fleet summary overlay.
    component.handleInput('c');
    const fleetLines = component.render(120).join('\n');
    expect(fleetLines).toContain('Fleet Summary');
    expect(fleetLines).toContain('States');
    expect(fleetLines).toContain('Avg health');
  });

  it('any key dismisses the fleet summary overlay (consumed)', () => {
    const { component } = makeComponent();

    component.handleInput('c');
    expect(component.render(120).join('\n')).toContain('Fleet Summary');

    // j would normally move focus, but here it only dismisses the overlay.
    component.handleInput('j');
    expect(component.render(120).join('\n')).not.toContain('Fleet Summary');
  });

  it('Esc closes the fleet summary first, not the dashboard', () => {
    const { component, isClosed } = makeComponent();

    component.handleInput('c');
    expect(component.render(120).join('\n')).toContain('Fleet Summary');

    // Esc dismisses the overlay but keeps the dashboard open.
    component.handleInput('\x1b');
    expect(isClosed()).toBe(false);
    expect(component.render(120).join('\n')).not.toContain('Fleet Summary');

    // A second Esc now closes the dashboard.
    component.handleInput('\x1b');
    expect(isClosed()).toBe(true);
  });
});

describe('Gen 68: dashboard fleet changes overlay', () => {
  it('D opens the fleet changes overlay in dashboard mode', () => {
    const { component } = makeComponent();

    // Before: no fleet changes overlay.
    expect(component.render(120).join('\n')).not.toContain('Fleet Changes');

    // D opens the fleet changes overlay.
    component.handleInput('D');
    const changesLines = component.render(120).join('\n');
    expect(changesLines).toContain('Fleet Changes');
    expect(changesLines).toContain('Total');
  });

  it('any key dismisses the fleet changes overlay (consumed)', () => {
    const { component } = makeComponent();

    component.handleInput('D');
    expect(component.render(120).join('\n')).toContain('Fleet Changes');

    // j would normally move focus, but here it only dismisses the overlay.
    component.handleInput('j');
    expect(component.render(120).join('\n')).not.toContain('Fleet Changes');
  });

  it('Esc closes the fleet changes first, not the dashboard', () => {
    const { component, isClosed } = makeComponent();

    component.handleInput('D');
    expect(component.render(120).join('\n')).toContain('Fleet Changes');

    // Esc dismisses the overlay but keeps the dashboard open.
    component.handleInput('\x1b');
    expect(isClosed()).toBe(false);
    expect(component.render(120).join('\n')).not.toContain('Fleet Changes');

    // A second Esc now closes the dashboard.
    component.handleInput('\x1b');
    expect(isClosed()).toBe(true);
  });
});
