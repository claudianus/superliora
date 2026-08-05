import { describe, expect, it, vi } from 'vitest';

import {
  PERSONA_PRESET_TIP,
  showPersonaSettings,
} from '#/tui/commands/config/persona/persona-settings';
import {
  buildPersonaSettingsLines,
  formatActivePersonaLine,
} from '#/tui/utils/persona/persona-glance';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makePersonaHost(
  options: {
    persona?: {
      name?: string;
      preset?: string;
      tone?: string;
      personality?: string;
      instructions?: string;
    };
    configError?: boolean;
  } = {},
) {
  const transcriptContainer = { addChild: vi.fn() };
  return {
    harness: {
      homeDir: '/home/.superliora',
      configPath: '/home/.superliora/config.toml',
      getConfig: options.configError
        ? vi.fn(async () => {
            throw new Error('config read failed');
          })
        : vi.fn(async () => ({ persona: options.persona })),
    },
    state: {
      transcriptContainer,
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
      centerModalStack: [] as readonly unknown[],
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectPersonaAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('persona glance', () => {
  it('formats active persona name from config', () => {
    expect(formatActivePersonaLine({ name: 'Liora' })).toBe('Active persona: Liora');
    expect(formatActivePersonaLine({ preset: 'mentor' })).toBe(
      'Active persona: mentor (preset)',
    );
    expect(formatActivePersonaLine(undefined)).toBe(
      'Active persona: Liora (default preset)',
    );
    expect(formatActivePersonaLine({ preset: 'none' })).toBe(
      'Active persona: disabled (preset = none)',
    );
    expect(formatActivePersonaLine({ name: 'old label', preset: 'none' })).toBe(
      'Active persona: disabled (preset = none)',
    );
  });
});

describe('persona settings', () => {
  it('mounts ChoicePicker then panel with live active name', async () => {
    const host = makePersonaHost({ persona: { name: 'Coach', preset: 'mentor' } });
    showPersonaSettings(host);
    selectPersonaAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const text = panel.snapshotBodyLines(1).join('\n');
    expect(text).toContain('Active persona: Coach');
    expect(text).toContain('efficient');
    expect(text).toContain('mentor');
    expect(host.harness.getConfig).toHaveBeenCalledWith({ reload: true });
  });

  it('renders when config load fails', async () => {
    const host = makePersonaHost({ configError: true });
    showPersonaSettings(host);
    selectPersonaAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('config read failed');
  });

  it('marks implicit Liora as current in the preset picker', async () => {
    const host = makePersonaHost();
    showPersonaSettings(host);
    selectPersonaAction(host, 'preset');

    await vi.waitFor(() => {
      expect((host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    });

    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    expect((picker as unknown as { opts: { currentValue?: string } }).opts.currentValue).toBe(
      'liora',
    );
  });
});
