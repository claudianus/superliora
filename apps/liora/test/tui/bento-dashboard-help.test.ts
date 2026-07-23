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

describe('Gen 70: pinned stream stats overlay', () => {
  function makeComponentWithView() {
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
    view.appendLine('hello world');
    let closed = false;
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map([['a', view]]),
      blinkPhase: false,
      onClose: () => {
        closed = true;
      },
    });
    return { component, grid, pin, isClosed: () => closed };
  }

  it('T opens the stream stats overlay in pinned mode', () => {
    const { component, pin } = makeComponentWithView();
    pin.pin('a');

    // Before: no stream stats overlay.
    expect(component.render(120).join('\n')).not.toContain('Stream Stats');

    // T opens the stream stats overlay.
    component.handleInput('T');
    const statsLines = component.render(120).join('\n');
    expect(statsLines).toContain('Stream Stats');
    expect(statsLines).toContain('Lines');
    expect(statsLines).toContain('Auto-follow');
  });

  it('any key dismisses the stream stats overlay (consumed)', () => {
    const { component, pin, grid } = makeComponentWithView();
    pin.pin('a');

    component.handleInput('T');
    expect(component.render(120).join('\n')).toContain('Stream Stats');

    // j would normally scroll, but here it only dismisses the overlay.
    component.handleInput('j');
    expect(component.render(120).join('\n')).not.toContain('Stream Stats');
    // Still pinned — the key was consumed by the overlay.
    expect(grid.getPinnedQuestId()).toBe('a');
  });

  it('Esc closes the stream stats first, not unpin', () => {
    const { component, pin, grid, isClosed } = makeComponentWithView();
    pin.pin('a');

    component.handleInput('T');
    expect(component.render(120).join('\n')).toContain('Stream Stats');

    // Esc dismisses the overlay but stays pinned.
    component.handleInput('\x1b');
    expect(grid.getPinnedQuestId()).toBe('a');
    expect(isClosed()).toBe(false);
    expect(component.render(120).join('\n')).not.toContain('Stream Stats');
  });
});

describe('Gen 103: summary bar approval count', () => {
  function makeComponentWithApproval() {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { state: 'waiting-approval' }));
    grid.addQuest(makeQuest('b', { state: 'waiting-approval' }));
    grid.addQuest(makeQuest('c', { state: 'failed' }));
    grid.addQuest(makeQuest('d', { state: 'running' }));
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
    return { component, grid, isClosed: () => closed };
  }

  it('shows approval count separately from attention count', () => {
    const { component } = makeComponentWithApproval();
    const output = component.render(120).join('\n');

    // 3 need attention (2 waiting-approval + 1 failed).
    expect(output).toContain('3 need attention');
    // 2 awaiting approval specifically.
    expect(output).toContain('2 awaiting approval');
  });

  it('omits approval count when none are awaiting', () => {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { state: 'running' }));
    grid.addQuest(makeQuest('b', { state: 'done' }));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map(),
      blinkPhase: false,
      onClose: () => {},
    });
    const output = component.render(120).join('\n');
    expect(output).not.toContain('awaiting approval');
  });
});

describe('Gen 111: summary bar failed count', () => {
  function makeComponentWithFailures() {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { state: 'failed' }));
    grid.addQuest(makeQuest('b', { state: 'failed' }));
    grid.addQuest(makeQuest('c', { state: 'waiting-approval' }));
    grid.addQuest(makeQuest('d', { state: 'running' }));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map(),
      blinkPhase: false,
      onClose: () => {},
    });
    return { component };
  }

  it('shows failed count separately from approval count', () => {
    const { component } = makeComponentWithFailures();
    const output = component.render(120).join('\n');

    // 3 need attention (2 failed + 1 waiting-approval).
    expect(output).toContain('3 need attention');
    // 1 awaiting approval specifically.
    expect(output).toContain('1 awaiting approval');
    // 2 failed specifically.
    expect(output).toContain('2 failed');
  });

  it('omits failed count when none have failed', () => {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { state: 'running' }));
    grid.addQuest(makeQuest('b', { state: 'done' }));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map(),
      blinkPhase: false,
      onClose: () => {},
    });
    const output = component.render(120).join('\n');
    expect(output).not.toContain('failed');
  });
});

describe('Gen 117: summary bar busiest callout', () => {
  function makeComponentWithChanges() {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { name: 'Small', changeCount: { added: 1, removed: 0 } }));
    grid.addQuest(makeQuest('b', { name: 'Big', changeCount: { added: 40, removed: 12 } }));
    grid.addQuest(makeQuest('c', { name: 'Mid', changeCount: { added: 8, removed: 3 } }));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map(),
      blinkPhase: false,
      onClose: () => {},
    });
    return { component };
  }

  it('shows the quest with the most code changes', () => {
    const { component } = makeComponentWithChanges();
    const output = component.render(120).join('\n');
    expect(output).toContain('busiest: Big 52');
  });

  it('omits busiest when there is only one quest', () => {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { changeCount: { added: 10, removed: 5 } }));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map(),
      blinkPhase: false,
      onClose: () => {},
    });
    const output = component.render(120).join('\n');
    expect(output).not.toContain('busiest');
  });
});

describe('Gen 105: summary bar sort reversal indicator', () => {
  function makeComponentWithCosts() {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { sessionCostUsd: 1 }));
    grid.addQuest(makeQuest('b', { sessionCostUsd: 5 }));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map(),
      blinkPhase: false,
      onClose: () => {},
    });
    return { component, grid };
  }

  it('shows the sort mode without a direction arrow when not reversed', () => {
    const { component, grid } = makeComponentWithCosts();
    grid.cycleSortMode(); // attention → cost

    const output = component.render(200).join('\n');
    expect(output).toContain('sort: cost');
    expect(output).not.toContain('cost ↓');
  });

  it('shows a direction arrow when the sort is reversed', () => {
    const { component, grid } = makeComponentWithCosts();
    grid.cycleSortMode(); // attention → cost
    grid.toggleSortReverse();

    const output = component.render(200).join('\n');
    expect(output).toContain('sort: cost ↓');
  });

  it('shows the reversal even on the default attention mode', () => {
    const { component, grid } = makeComponentWithCosts();
    grid.toggleSortReverse();

    const output = component.render(200).join('\n');
    expect(output).toContain('sort: attention ↓');
  });
});

describe('Gen 110: live match count while filtering', () => {
  function makeComponentWithNames() {
    const grid = new QuestGridController({
      getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
      requestRender: () => {},
    });
    grid.addQuest(makeQuest('a', { name: 'Refactor auth' }));
    grid.addQuest(makeQuest('b', { name: 'Fix login bug' }));
    grid.addQuest(makeQuest('c', { name: 'AUTH tests' }));
    const attention = new AttentionController({
      writeRaw: () => {},
      requestRender: () => {},
    });
    const pin = new PinController({ gridController: grid, requestRender: () => {} });
    const component = new BentoDashboardComponent({
      gridController: grid,
      attentionController: attention,
      pinController: pin,
      expandViews: new Map(),
      blinkPhase: false,
      onClose: () => {},
    });
    return { component };
  }

  it('shows the live match count while typing the filter', () => {
    const { component } = makeComponentWithNames();
    component.handleInput('/');
    for (const ch of 'auth') component.handleInput(ch);

    const output = component.render(120).join('\n');
    // Two quests match "auth" out of three total.
    expect(output).toContain('filter: auth');
    expect(output).toContain('2/3 match');
  });

  it('updates the count as the query narrows', () => {
    const { component } = makeComponentWithNames();
    component.handleInput('/');
    for (const ch of 'login') component.handleInput(ch);

    const output = component.render(120).join('\n');
    // Only one quest matches "login".
    expect(output).toContain('1/3 match');
  });
});
