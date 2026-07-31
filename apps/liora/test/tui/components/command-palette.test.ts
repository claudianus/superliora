import { describe, expect, it, vi } from 'vitest';

import {
  CommandPaletteComponent,
  rankPaletteEntries,
  type PaletteEntry,
} from '#/tui/components/dialogs/command-hub/command-palette';
import {
  buildDefaultCommandHubItems,
  commandHubNestsPicker,
} from '#/tui/components/dialogs/command-hub/index';
import { commandHubActionToSlash } from '#/tui/utils/command/command-hub-actions';

const ENTER = '\r';
const ESCAPE = '\u001B';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const ENTRIES: readonly PaletteEntry[] = [
  {
    kind: 'action',
    value: 'hub',
    label: 'Command Hub',
    description: 'Open the guided dashboard',
  },
  {
    kind: 'command',
    value: 'model',
    label: '/model',
    description: 'Switch the LLM',
    aliases: ['switchy'],
  },
  {
    kind: 'skill',
    value: 'skill:commit',
    label: '/skill:commit',
    description: 'Commit workflow',
  },
];

describe('rankPaletteEntries', () => {
  it('orders by descending score and keeps authored order on ties', () => {
    const entries: PaletteEntry[] = [
      { kind: 'command', value: 'model', label: '/model' },
      { kind: 'command', value: 'plan', label: '/plan' },
      { kind: 'command', value: 'diff', label: '/diff' },
    ];
    const ranked = rankPaletteEntries(entries, (entry) =>
      entry.value === 'diff' ? 5 : entry.value === 'model' ? 2 : 2,
    );
    expect(ranked.map((entry) => entry.value)).toEqual(['diff', 'model', 'plan']);
  });

  it('returns an empty list unchanged', () => {
    expect(rankPaletteEntries([], () => 1)).toEqual([]);
  });
});

describe('CommandPaletteComponent', () => {
  it('runs the highlighted entry on Enter', () => {
    const onSelect = vi.fn();
    const palette = new CommandPaletteComponent({
      entries: ENTRIES,
      onSelect,
      onCancel: vi.fn(),
    });
    palette.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.value).toBe('hub');
  });

  it('fuzzy-filters entries by typed query', () => {
    const palette = new CommandPaletteComponent({
      entries: ENTRIES,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    // "mdl" only matches /model (m…d…l) — not "Command Hub" or /skill:commit.
    for (const ch of 'mdl') palette.handleInput(ch);
    const text = stripAnsi(palette.render(80).join('\n'));
    expect(text).toContain('/model');
    expect(text).not.toContain('Command Hub');
    expect(text).not.toContain('/skill:commit');
  });

  it('matches aliases without rendering them', () => {
    const palette = new CommandPaletteComponent({
      entries: ENTRIES,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    for (const ch of 'switchy') palette.handleInput(ch);
    // Drop the `Search:` echo line — the query itself contains the alias.
    const body = stripAnsi(palette.render(80).join('\n'))
      .split('\n')
      .filter((line) => !line.trim().startsWith('Search:'))
      .join('\n');
    expect(body).toContain('/model');
    expect(body).not.toContain('switchy');
    expect(body).not.toContain('Command Hub');
  });

  it('Esc clears the query first, then cancels', () => {
    const onCancel = vi.fn();
    const palette = new CommandPaletteComponent({
      entries: ENTRIES,
      onSelect: vi.fn(),
      onCancel,
    });
    for (const ch of 'mod') palette.handleInput(ch);
    palette.handleInput(ESCAPE);
    expect(onCancel).not.toHaveBeenCalled();
    // Query cleared → full list is visible again.
    expect(stripAnsi(palette.render(80).join('\n'))).toContain('Command Hub');
    palette.handleInput(ESCAPE);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('palette hub wiring', () => {
  it('exposes Search tip as a non-nested Help action (Hub One-search)', () => {
    const items = buildDefaultCommandHubItems({});
    const item = items.find((candidate) => candidate.id === 'help.palette');
    expect(item?.section).toBe('Help');
    expect(item?.label).toBe('Search tip');
    expect(commandHubNestsPicker('help.palette')).toBe(false);
    expect(commandHubActionToSlash('help.palette')).toBeUndefined();
  });
});
