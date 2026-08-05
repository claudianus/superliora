import { describe, expect, it, vi } from 'vitest';

import {
  buildDefaultCommandHubItems,
  CommandHubComponent,
  commandHubNestsPicker,
  cyclePermissionMode,
  isCommandHubToggleId,
} from '#/tui/components/dialogs/command-hub/index';
import { commandHubActionToSlash } from '#/tui/utils/command/command-hub-actions';
import { noteHubActionUse, resetHubRecentsForTests } from '#/tui/utils/command/hub-recents';

const ENTER = '\r';
const ESCAPE = '\u001B';
const DOWN = '\u001B[B';
const LEFT = '\u001B[D';
const RIGHT = '\u001B[C';
const SPACE = ' ';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('buildDefaultCommandHubItems', () => {
  it('includes beginner sections and mode badges', () => {
    const items = buildDefaultCommandHubItems({
      planMode: true,
      swarmMode: false,
      permissionMode: 'auto',
      model: 'demo-model',
    });
    expect(items.some((item) => item.id === 'modes.plan' && item.badge === 'ON')).toBe(true);
    expect(items.some((item) => item.id === 'chat.model' && item.badge === 'demo-model')).toBe(
      true,
    );
    expect(items.some((item) => item.section === 'Start')).toBe(true);
    expect(items.some((item) => item.id === 'help.shortcuts')).toBe(true);
    expect(isCommandHubToggleId('modes.plan')).toBe(true);
  });

  it('includes Phase 1 operator Hub rows', () => {
    const items = buildDefaultCommandHubItems({});
    const ids = new Set(items.map((item) => item.id));
    for (const id of [
      'workspace.dashboard',
      'workspace.errors',
      'workspace.jobOps',
      'workspace.cron',
      'chat.rewind',
      'chat.loops',
      'start.fork',
      'account.logout',
      'modes.goals',
      'modes.ultraplan',
    ] as const) {
      expect(ids.has(id)).toBe(true);
    }
    expect(items.find((item) => item.id === 'modes.ultraplan')?.searchOnly).toBe(true);
    expect(items.find((item) => item.id === 'modes.ultrawork')?.description).toContain(
      'type objective',
    );
    expect(items.find((item) => item.id === 'help.commands')?.description).toContain(
      'prefer Hub search',
    );
    expect(commandHubNestsPicker('workspace.jobOps')).toBe(true);
    expect(commandHubNestsPicker('chat.loops')).toBe(true);
    expect(commandHubNestsPicker('workspace.cron')).toBe(true);
    expect(commandHubActionToSlash('workspace.dashboard')).toBe('/dashboard');
    expect(commandHubActionToSlash('chat.rewind')).toBe('/rewind');
    expect(commandHubActionToSlash('modes.goals')).toBe('/goal next manage');
    expect(commandHubActionToSlash('modes.ultraplan')).toBe('/ultraplan');
  });

  it('adds Fleet War Room when swarmMode is on, and omits it when off', () => {
    const off = buildDefaultCommandHubItems({ swarmMode: false });
    expect(off.some((item) => item.id === 'fleet.warRoom')).toBe(false);

    const on = buildDefaultCommandHubItems({ swarmMode: true });
    const warRoom = on.find((item) => item.id === 'fleet.warRoom');
    expect(warRoom?.section).toBe('Fleet');
    expect(warRoom?.label).toBe('War Room…');
    expect(commandHubNestsPicker('fleet.warRoom')).toBe(true);
    expect(commandHubActionToSlash('fleet.warRoom')).toBeUndefined();
  });

  it('adds a Now section while streaming and hides Chat undo/compact dupes', () => {
    const items = buildDefaultCommandHubItems({ streamingPhase: 'composing' });
    expect(items.some((item) => item.id === 'now.steer' && item.section === 'Now')).toBe(true);
    expect(items.some((item) => item.id === 'chat.undo')).toBe(false);
    expect(items.some((item) => item.id === 'chat.rewind')).toBe(false);
    expect(items.some((item) => item.id === 'now.undo')).toBe(true);
  });

  it('relabels login when already signed in', () => {
    const items = buildDefaultCommandHubItems({ signedIn: true });
    const login = items.find((item) => item.id === 'account.login');
    expect(login?.label).toBe('Add provider');
    expect(login?.badge).toBe('ready');
  });
});

describe('commandHubActionToSlash', () => {
  it('maps hub actions to slash commands', () => {
    expect(commandHubActionToSlash('chat.model')).toBe('/model');
    expect(commandHubActionToSlash('modes.swarm')).toBe('/swarm');
    expect(commandHubActionToSlash('modes.ultrawork')).toBeUndefined();
    expect(commandHubActionToSlash('extend.extensions')).toBeUndefined();
    expect(commandHubActionToSlash('help.shortcuts')).toBeUndefined();
    expect(commandHubActionToSlash('now.compact')).toBe('/compact');
    expect(commandHubActionToSlash('fleet.warRoom')).toBeUndefined();
  });
});

describe('Mission Hub row', () => {
  it('starts /mission instead of pretending to toggle like Plan/Swarm', () => {
    const item = buildDefaultCommandHubItems({ ultraworkMode: true }).find(
      (candidate) => candidate.id === 'modes.ultrawork',
    );
    expect(item?.label).toBe('Start Mission…');
    expect(item?.kind).not.toBe('toggle');
    expect(item?.badge).toBe('ON');
    expect(isCommandHubToggleId('modes.ultrawork')).toBe(false);
    expect(commandHubActionToSlash('modes.ultrawork')).toBeUndefined();
  });
});

describe('Extend Extensions Hub row', () => {
  it('nests into Settings Extensions instead of /extensions slash', () => {
    const item = buildDefaultCommandHubItems({}).find(
      (candidate) => candidate.id === 'extend.extensions',
    );
    expect(item?.label).toBe('Extensions');
    expect(commandHubNestsPicker('extend.extensions')).toBe(true);
    expect(commandHubActionToSlash('extend.extensions')).toBeUndefined();
  });
});

describe('cyclePermissionMode', () => {
  it('cycles manual → auto → yolo → manual', () => {
    expect(cyclePermissionMode('manual')).toBe('auto');
    expect(cyclePermissionMode('auto')).toBe('yolo');
    expect(cyclePermissionMode('yolo')).toBe('manual');
  });
});

describe('help.searchTip removed', () => {
  it('no longer ships a tip-only Hub row (search is the empty filter + type)', () => {
    const items = buildDefaultCommandHubItems({});
    // The id is gone from the union, so compare as strings — the guard has to
    // outlive the type it used to check.
    expect(items.map((item) => item.id as string)).not.toContain('help.searchTip');
    expect(items.every((item) => !/search tip/i.test(item.label))).toBe(true);
  });
});

describe('CommandHubComponent', () => {
  it('filters by query and invokes onSelect', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect,
      onCancel,
    });
    for (const ch of 'model') hub.handleInput(ch);
    const text = stripAnsi(hub.render(72).join('\n'));
    expect(text).toContain('Model');
    while (onSelect.mock.calls.length === 0) {
      const selected = stripAnsi(hub.render(72).join('\n'));
      if (selected.includes('Switch the LLM')) {
        hub.handleInput(ENTER);
        break;
      }
      hub.handleInput(DOWN);
    }
    expect(onSelect).toHaveBeenCalled();
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe('chat.model');
    expect(onSelect.mock.calls[0]?.[1]).toBe('enter');
  });

  it('Space activates toggle rows', () => {
    const onSelect = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect,
      onCancel: vi.fn(),
    });
    while (onSelect.mock.calls.length === 0) {
      const selected = stripAnsi(hub.render(72).join('\n'));
      if (selected.includes('think first') || selected.includes('flips & close · think')) {
        hub.handleInput(SPACE);
        break;
      }
      hub.handleInput(DOWN);
    }
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe('modes.plan');
    expect(onSelect.mock.calls[0]?.[1]).toBe('space');
  });

  it('Space while filtering extends the query (multi-word search)', () => {
    const onSelect = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect,
      onCancel: vi.fn(),
    });
    for (const ch of 'job') hub.handleInput(ch);
    hub.handleInput(SPACE);
    expect(onSelect).not.toHaveBeenCalled();
    for (const ch of 'ops') hub.handleInput(ch);
    const text = stripAnsi(hub.render(72).join('\n'));
    expect(text).toContain('job ops');
  });

  it('Esc clears filter before closing', () => {
    const onCancel = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel,
    });
    for (const ch of 'model') hub.handleInput(ch);
    expect(stripAnsi(hub.render(72).join('\n'))).toMatch(/model.*\d+\/\d+/);
    hub.handleInput(ESCAPE);
    expect(onCancel).not.toHaveBeenCalled();
    expect(stripAnsi(hub.render(72).join('\n'))).toContain('Search actions');
    hub.handleInput(ESCAPE);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on escape when filter is empty', () => {
    const onCancel = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel,
    });
    hub.handleInput(ESCAPE);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders the slim status strip with mode LEDs', () => {
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({ planMode: true, permissionMode: 'yolo' }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const text = stripAnsi(hub.render(72).join('\n'));
    expect(text).toContain('Command Hub');
    expect(text).toContain('Plan ● on');
    expect(text).toContain('Swarm ○ off');
    expect(text).toContain('Perm YOLO');
  });

  it('digits type into the search query (no hidden hotkeys)', () => {
    const onSelect = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect,
      onCancel: vi.fn(),
    });
    hub.handleInput('1');
    expect(onSelect).not.toHaveBeenCalled();
    const text = stripAnsi(hub.render(72).join('\n'));
    expect(text).toMatch(/❯ 1/);
    expect(text).toMatch(/\d+\/\d+/);
  });

  it('←→ jumps between sections', () => {
    resetHubRecentsForTests();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const bottom = (lines: string[]): string =>
      lines.find((line) => line.includes('╰')) ?? '';
    const first = stripAnsi(hub.render(96).join('\n')).split('\n');
    expect(bottom(first)).toContain('Modes');
    hub.handleInput(RIGHT);
    const next = stripAnsi(hub.render(96).join('\n')).split('\n');
    expect(bottom(next)).toContain('Start');
    hub.handleInput(LEFT);
    const back = stripAnsi(hub.render(96).join('\n')).split('\n');
    expect(bottom(back)).toContain('Modes');
  });

  it('pins Recent actions when idle', () => {
    resetHubRecentsForTests();
    noteHubActionUse('workspace.diff');
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const text = stripAnsi(hub.render(72).join('\n'));
    expect(text).toContain('Recent');
    expect(text.indexOf('Recent')).toBeLessThan(text.indexOf('Modes'));
  });

  it('boosts recent actions when searching', () => {
    resetHubRecentsForTests();
    noteHubActionUse('workspace.diff');
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
      initialQuery: 'd',
    });
    const text = stripAnsi(hub.render(72).join('\n'));
    const diffAt = text.indexOf('Diff');
    const modelAt = text.indexOf('Model');
    expect(diffAt).toBeGreaterThanOrEqual(0);
    if (modelAt >= 0) expect(diffAt).toBeLessThan(modelAt);
  });

  it('frames the hub in a rounded box with the title in the border', () => {
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const lines = stripAnsi(hub.render(72).join('\n')).split('\n');
    const top = lines.find((line) => line.includes('╭')) ?? '';
    const bottom = lines.find((line) => line.includes('╰')) ?? '';
    expect(top).toContain('Command Hub');
    expect(top.trim().endsWith('╮')).toBe(true);
    expect(bottom.trim().endsWith('╯')).toBe(true);
    expect(lines.some((line) => line.includes('│'))).toBe(true);
  });

  it('shows the query and match count in the always-visible search row', () => {
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const idle = stripAnsi(hub.render(72).join('\n'));
    expect(idle).toContain('Search actions, settings, skills');
    for (const ch of 'model') hub.handleInput(ch);
    const filtered = stripAnsi(hub.render(72).join('\n'));
    expect(filtered).toMatch(/❯ model/);
    expect(filtered).toMatch(/\d+\/\d+/);
    const bottom = filtered.split('\n').find((line) => line.includes('╰')) ?? '';
    expect(bottom).toContain('Esc clear');
  });

  it('pulses the empty state when nothing matches', () => {
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    for (const ch of 'zzzz') hub.handleInput(ch);
    const text = stripAnsi(hub.render(72).join('\n'));
    expect(text).toContain('No matches');
  });

  it('renders a deterministic static frame when motion is disallowed', () => {
    vi.stubEnv('TERM', 'dumb');
    try {
      const hub = new CommandHubComponent({
        items: buildDefaultCommandHubItems({}),
        onSelect: vi.fn(),
        onCancel: vi.fn(),
      });
      const first = hub.render(72).join('\n');
      const second = hub.render(72).join('\n');
      expect(stripAnsi(first)).toContain('╭');
      expect(first).toBe(second);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('CommandHubComponent palette redesign', () => {
  const makeHub = (terminalRows?: number): CommandHubComponent =>
    new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
      terminalRows: terminalRows === undefined ? undefined : () => terminalRows,
    });

  it('windows the idle list by terminal height with more-indicators', () => {
    resetHubRecentsForTests();
    const hub = makeHub(20);
    const first = stripAnsi(hub.render(96).join('\n'));
    expect(first).toMatch(/▼ \d+ more/);
    expect(first).not.toMatch(/▲ \d+ more/);
    hub.handleInput('\u001B[6~'); // PageDown
    const paged = stripAnsi(hub.render(96).join('\n'));
    expect(paged).toMatch(/▲ \d+ more/);
  });

  it('keeps every rendered row inside the frame width', () => {
    resetHubRecentsForTests();
    const hub = makeHub();
    for (const width of [56, 72, 96, 120]) {
      for (const line of stripAnsi(hub.render(width).join('\n')).split('\n')) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });

  it('shows inline descriptions on wide renders, selected-only on narrow', () => {
    resetHubRecentsForTests();
    const wide = makeHub();
    for (const ch of 'model') wide.handleInput(ch);
    const wideLines = stripAnsi(wide.render(100).join('\n')).split('\n');
    expect(
      wideLines.some((line) => line.includes('Model') && line.includes('Switch the LLM')),
    ).toBe(true);

    const narrow = makeHub();
    for (const ch of 'model') narrow.handleInput(ch);
    const narrowLines = stripAnsi(narrow.render(60).join('\n')).split('\n');
    expect(
      narrowLines.some((line) => line.includes('Model') && line.includes('Switch the LLM')),
    ).toBe(false);
  });

  it('resets the cursor to the best match when the query changes', () => {
    resetHubRecentsForTests();
    const hub = makeHub();
    hub.handleInput(DOWN);
    hub.handleInput(DOWN);
    for (const ch of 'diff') hub.handleInput(ch);
    const text = stripAnsi(hub.render(96).join('\n'));
    const bottom = text.split('\n').find((line) => line.includes('╰')) ?? '';
    // First fuzzy match is selected → its section shows in the bottom border.
    expect(bottom).toContain('Workspace');
  });
});
