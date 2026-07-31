import { describe, expect, it, vi } from 'vitest';

import {
  KEYBINDINGS_COMMAND_HUB_TIP,
  KEYBINDINGS_FUTURE_EDITOR_TIP,
  KEYBINDINGS_HELP_TIP,
  KEYBINDINGS_REGISTRY_TIP,
  showKeybindingsSettings,
} from '#/tui/commands/config/keybindings/keybindings-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeKeybindingsHost() {
  return {
    state: {
      transcriptContainer: { addChild: vi.fn() },
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectKeybindingsAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

function panelLines(host: SlashCommandHost): string {
  const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
    .calls[0]?.[0] as UsagePanelComponent;
  return panel.snapshotBodyLines(1).join('\n');
}

describe('keybindings settings tips', () => {
  it('exports registry, help, command hub, and future editor tips', () => {
    expect(KEYBINDINGS_REGISTRY_TIP).toContain('keymap.ts');
    expect(KEYBINDINGS_REGISTRY_TIP).toContain('SSOT');
    expect(KEYBINDINGS_HELP_TIP).toContain('/help');
    expect(KEYBINDINGS_COMMAND_HUB_TIP).toContain('Ctrl-K');
    expect(KEYBINDINGS_COMMAND_HUB_TIP).toContain('?');
    expect(KEYBINDINGS_FUTURE_EDITOR_TIP).toContain('Custom keybinding editor');
    expect(KEYBINDINGS_FUTURE_EDITOR_TIP).toContain('Settings → Editor');
  });
});

describe('showKeybindingsSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions', () => {
    const host = makeKeybindingsHost();
    showKeybindingsSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'tip-registry',
      'tip-help',
      'tip-command-hub',
      'tip-future',
    ]);
  });

  it('shows registry tip via showStatus', () => {
    const host = makeKeybindingsHost();
    showKeybindingsSettings(host);
    selectKeybindingsAction(host, 'tip-registry');
    expect(host.showStatus).toHaveBeenCalledWith(KEYBINDINGS_REGISTRY_TIP, 'info');
  });

  it('shows help tip via showStatus', () => {
    const host = makeKeybindingsHost();
    showKeybindingsSettings(host);
    selectKeybindingsAction(host, 'tip-help');
    expect(host.showStatus).toHaveBeenCalledWith(KEYBINDINGS_HELP_TIP, 'info');
  });

  it('shows command hub tip via showStatus', () => {
    const host = makeKeybindingsHost();
    showKeybindingsSettings(host);
    selectKeybindingsAction(host, 'tip-command-hub');
    expect(host.showStatus).toHaveBeenCalledWith(KEYBINDINGS_COMMAND_HUB_TIP, 'info');
  });

  it('mounts read-only keybindings panel for status', () => {
    const host = makeKeybindingsHost();
    showKeybindingsSettings(host);
    selectKeybindingsAction(host, 'status');

    const lines = panelLines(host);
    expect(lines).toContain('Keyboard / Keybindings (read-only)');
    expect(lines).toContain('Live registry (keymap.ts)');
    expect(lines).toContain('Mission / Ops / Fleet samples');
    expect(lines).toContain('/help');
    expect(lines).toContain('Shift-Tab');
  });
});
