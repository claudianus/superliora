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

  it('Space on open rows activates (not a silent no-op)', () => {
    const onSelect = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect,
      onCancel: vi.fn(),
    });
    for (const ch of 'files') hub.handleInput(ch);
    while (onSelect.mock.calls.length === 0) {
      const selected = stripAnsi(hub.render(72).join('\n'));
      if (selected.includes('Browse the project tree')) {
        hub.handleInput(SPACE);
        break;
      }
      hub.handleInput(DOWN);
    }
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe('workspace.files');
    expect(onSelect.mock.calls[0]?.[1]).toBe('space');
  });

  it('Esc clears filter before closing', () => {
    const onCancel = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel,
    });
    for (const ch of 'model') hub.handleInput(ch);
    expect(stripAnsi(hub.render(72).join('\n'))).toContain('filter: model');
    hub.handleInput(ESCAPE);
    expect(onCancel).not.toHaveBeenCalled();
    expect(stripAnsi(hub.render(72).join('\n'))).not.toContain('filter: model');
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

  it('renders status strip and hotkey digits', () => {
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({ planMode: true, permissionMode: 'yolo' }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const text = stripAnsi(hub.render(72).join('\n'));
    expect(text).toContain('Command Hub');
    expect(text).toMatch(/\[Plan ON\]/i);
    expect(text).toMatch(/\[YOLO\]/i);
    expect(text).toMatch(/\b1\s/);
  });

  it('number hotkey activates a row when not filtering', () => {
    const onSelect = vi.fn();
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect,
      onCancel: vi.fn(),
    });
    hub.handleInput('1');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]?.[1]).toBe('enter');
  });

  it('←→ moves between categories and items in wide idle two-pane', () => {
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    hub.render(96);
    const modesView = stripAnsi(hub.render(96).join('\n'));
    expect(modesView).toContain('Modes');
    expect(modesView).toMatch(/Plan mode/i);
    hub.handleInput(LEFT);
    hub.handleInput(DOWN);
    const startView = stripAnsi(hub.render(96).join('\n'));
    expect(startView).toMatch(/New session|Start/i);
    hub.handleInput(RIGHT);
    const itemsFocused = stripAnsi(hub.render(96).join('\n'));
    expect(itemsFocused.length).toBeGreaterThan(0);
    expect(itemsFocused).not.toBe(modesView);
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

  it('embeds the live filter and match count in the bottom border', () => {
    const hub = new CommandHubComponent({
      items: buildDefaultCommandHubItems({}),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    for (const ch of 'model') hub.handleInput(ch);
    const lines = stripAnsi(hub.render(72).join('\n')).split('\n');
    const bottom = lines.find((line) => line.includes('╰')) ?? '';
    expect(bottom).toContain('filter: model');
    expect(bottom).toMatch(/\d+\/\d+/);
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
