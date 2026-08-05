import { describe, expect, it, vi } from 'vitest';

import { showMemorySettings } from '#/tui/commands/config/memory/memory-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

vi.mock('#/tui/commands/memory/memory', () => ({
  handleMemoryCommand: vi.fn(async () => undefined),
}));

import { handleMemoryCommand } from '#/tui/commands/memory/memory';

function makeMemoryHost() {
  return {
    state: {
      centerModalStack: [] as readonly unknown[],
      appState: { workDir: '/tmp' },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    harness: { memory: {} },
  } as unknown as SlashCommandHost;
}

function selectMemoryAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('memory settings', () => {
  it('opens a picker and dispatches stats through handleMemoryCommand', () => {
    const host = makeMemoryHost();
    showMemorySettings(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    selectMemoryAction(host, 'stats');
    expect(handleMemoryCommand).toHaveBeenCalledWith(host, 'stats');
  });

  it('lists wiki as an action row', () => {
    const host = makeMemoryHost();
    showMemorySettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((option) => option.value)).toEqual(
      expect.arrayContaining(['stats', 'list', 'search', 'remember', 'forget', 'wiki', 'consolidate']),
    );
  });
});
