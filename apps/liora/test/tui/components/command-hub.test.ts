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
    expect(items.some((item) => item.id === 'help.searchTip' && item.label === 'Search tip')).toBe(
      true,
    );
    expect(isCommandHubToggleId('modes.plan')).toBe(true);
  });

  it('adds a Now section while streaming and hides Chat undo/compact dupes', () => {
    const items = buildDefaultCommandHubItems({ streamingPhase: 'composing' });
    expect(items.some((item) => item.id === 'now.steer' && item.section === 'Now')).toBe(true);
    expect(items.some((item) => item.id === 'chat.undo')).toBe(false);
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

describe('help.searchTip', () => {
  it('stays non-nested so One-search remains the only catalog', () => {
    const item = buildDefaultCommandHubItems({}).find(
      (candidate) => candidate.id === 'help.searchTip',
    );
    expect(item?.label).toBe('Search tip');
    expect(commandHubNestsPicker('help.searchTip')).toBe(false);
    expect(commandHubActionToSlash('help.searchTip')).toBeUndefined();
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
    expect(text).toMatch(/\[PLAN\]/i);
    expect(text).toMatch(/\[yolo\]/i);
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
